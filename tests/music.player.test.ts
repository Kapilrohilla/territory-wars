import { afterEach, describe, expect, it } from 'vitest';
import { MAX_GAIN, getTranspose, setTranspose } from '../src/game/sound';
import type { Layer } from '../src/game/music/composer';
import { VOICES } from '../src/game/music/instruments';
import { createMusicPlayer, type MusicPlayer } from '../src/game/music/player';
import { BPM, STEPS_PER_BAR, stepSeconds } from '../src/game/music/theory';

/** A mock AudioContext whose clock only moves when the test advances it. */
type Call = { kind: string; v: number; t: number };
class FakeParam {
  value = 1;
  calls: Call[] = [];
  setValueAtTime(v: number, t: number) { this.calls.push({ kind: 'set', v, t }); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'lin', v, t }); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'exp', v, t }); }
  setTargetAtTime(v: number, t: number) { this.calls.push({ kind: 'target', v, t }); }
  cancelScheduledValues(t: number) { this.calls.push({ kind: 'cancel', v: 0, t }); }
  cancelAndHoldAtTime(t: number) { this.calls.push({ kind: 'hold', v: 0, t }); }
}
class FakeNode {
  disconnected = false;
  /** Set when this node drives an AudioParam (a modulator, not part of the audio path). */
  modulates = false;
  targets: unknown[] = [];
  connect(to?: unknown) { if (to instanceof FakeParam) this.modulates = true; this.targets.push(to); }
  disconnect() { this.disconnected = true; }
}
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  startT = -1;
  /** The context time when the voice was built. */
  createdAt = 0;
  stopT = Infinity;
  ended = false;
  start(t: number) { this.startT = t; }
  stop(t: number) { this.stopT = t; }
}
class FakeCtx {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  nodes: FakeNode[] = [];
  oscs: FakeSource[] = [];
  sources: FakeSource[] = [];
  gains: FakeParam[] = [];
  gainNodes: (FakeNode & { gain: FakeParam })[] = [];
  filters: { frequency: FakeParam }[] = [];
  private track<T extends FakeNode>(n: T): T { this.nodes.push(n); return n; }
  createGain() {
    const n = this.track(Object.assign(new FakeNode(), { gain: new FakeParam() }));
    this.gains.push(n.gain);
    this.gainNodes.push(n);
    return n;
  }
  createOscillator() {
    const o = this.track(new FakeSource());
    o.createdAt = this.currentTime;
    this.oscs.push(o);
    this.sources.push(o);
    return o;
  }
  createBufferSource() { const s = this.track(new FakeSource()); s.createdAt = this.currentTime; this.sources.push(s); return s; }
  createBiquadFilter() {
    const f = this.track(Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }));
    this.filters.push(f);
    return f;
  }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  /** Moves the clock and fires onended for every source whose stop time has passed. */
  advance(to: number) {
    this.currentTime = to;
    for (const s of this.sources) {
      if (!s.ended && s.stopT <= to) { s.ended = true; s.onended?.(); }
    }
  }
  /** Sources sounding now (started at or before the clock, not ended). */
  live() { return this.sources.filter((s) => s.startT >= 0 && s.startT <= this.currentTime && !s.ended).length; }
  /** Sources scheduled at all and not ended yet (sounding or queued ahead). */
  queued() { return this.sources.filter((s) => s.startT >= 0 && !s.ended).length; }
}

/** Fake timers that run only when the test steps them. */
class FakeTimers {
  private next = 1;
  pending = new Map<number, { fn: () => void; at: number }>();
  now = 0;
  set = (fn: () => void, ms: number) => { const id = this.next++; this.pending.set(id, { fn, at: this.now + ms }); return id; };
  clear = (id: number) => { this.pending.delete(id); };
  /** Runs timers due within `ms`, keeping the audio clock in step. */
  run(ms: number, ctx: FakeCtx | null) {
    const end = this.now + ms;
    for (;;) {
      let first: [number, { fn: () => void; at: number }] | null = null;
      for (const e of this.pending) if (e[1].at <= end && (!first || e[1].at < first[1].at)) first = e;
      if (!first) break;
      this.pending.delete(first[0]);
      this.now = first[1].at;
      ctx?.advance(this.now / 1000);
      first[1].fn();
    }
    this.now = end;
    ctx?.advance(end / 1000);
  }
}

const last = <T>(xs: T[]): T => xs[xs.length - 1];
const BAR_S = STEPS_PER_BAR * stepSeconds(BPM.normal);
const bus = new FakeNode() as unknown as AudioNode;

function setup(opts: { roundKey?: number; ctxNullTicks?: number; audible?: () => boolean } = {}) {
  const ctx = new FakeCtx();
  const timers = new FakeTimers();
  let nullTicks = opts.ctxNullTicks ?? 0;
  const player = createMusicPlayer({
    difficulty: 'normal', seed: 42, roundKey: opts.roundKey ?? 0,
    ctx: () => (nullTicks-- > 0 ? null : (ctx as unknown as AudioContext)),
    bus: () => bus,
    audible: opts.audible ?? (() => true),
    timers,
  });
  return { ctx, timers, player };
}

let players: MusicPlayer[] = [];
afterEach(() => { for (const p of players) p.dispose(); players = []; setTranspose(0); });

describe('music player', () => {
  it('schedules_ahead_only', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.setMood({ tier: 1, danger: 0 });
    player.start();
    timers.run(0, ctx);
    expect(ctx.oscs.length).toBeGreaterThan(0);
    for (const o of ctx.oscs) expect(o.startT).toBeLessThan(0.12);
    timers.run(3 * BAR_S * 1000, ctx);
    player.events([{ e: 'steal', size: 3 }]); // a bar-long riff is queued, not built at once
    timers.run(3 * BAR_S * 1000, ctx);
    // Every voice is built only once its note starts within the 0.12 s horizon.
    for (const s of ctx.sources) expect(s.startT - s.createdAt).toBeLessThan(0.12 + 1e-9);
  });

  it('scheduler_holds_no_backlog', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.setMood({ tier: 1, danger: 0 });
    player.start();
    let maxLive = 0, maxQueued = 0;
    for (let s = 0; s < 300; s++) {
      timers.run(1000, ctx);
      if (s % 20 === 5) player.events([{ e: 'steal', size: 2 }]);
      maxLive = Math.max(maxLive, ctx.live());
      maxQueued = Math.max(maxQueued, ctx.queued());
      expect(timers.pending.size).toBe(1);
    }
    expect(maxLive).toBeLessThan(64);
    // Only what's sounding plus 0.12 s of notes: no bar is built ahead.
    expect(maxQueued - maxLive).toBeLessThan(32);
    expect(maxQueued).toBeLessThan(80);
    // Bars kept coming the whole time, never more than the horizon ahead.
    const last = Math.max(...ctx.oscs.map((o) => o.startT));
    expect(last).toBeGreaterThan(299 - BAR_S);
    expect(last).toBeLessThanOrEqual(300 + 0.12 + BAR_S);
  });

  it('events_when_idle_are_ignored', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    const count = () => ctx.oscs.length + ctx.sources.length;
    expect(() => player.events([{ e: 'steal', size: 3 }, { e: 'kill', size: 2 }])).not.toThrow();
    expect(() => player.setMood({ tier: 2, danger: 1 })).not.toThrow();
    expect(count()).toBe(0);
    expect(player.playing).toBe(false);

    player.start();
    timers.run(100, ctx);
    expect(player.playing).toBe(true);
    player.pause();
    expect(player.playing).toBe(false);
    expect(timers.pending.size).toBe(0);
    let n = count();
    player.events([{ e: 'steal', size: 3 }]);
    player.setMood({ tier: 3, danger: 1 });
    timers.run(5000, ctx);
    expect(count()).toBe(n);

    player.resume();
    timers.run(5000, ctx);
    player.events([{ e: 'gameover' }]);
    expect(count()).toBeGreaterThan(n); // the closing cadence
    timers.run(100, ctx);
    n = count();
    player.events([{ e: 'steal', size: 3 }, { e: 'milestone' }]);
    timers.run(10_000, ctx);
    expect(count()).toBe(n);

    player.dispose();
    timers.run(5000, ctx); // the deferred graph teardown is the only timer left
    expect(timers.pending.size).toBe(0);
    expect(() => { player.events([{ e: 'steal' }]); player.setMood({ tier: 1, danger: 0 }); player.resume(); }).not.toThrow();
    timers.run(5000, ctx);
    expect(count()).toBe(n);
  });

  it('dispose_after_win_lets_the_cadence_finish', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(100, ctx);
    const nodesBefore = ctx.nodes.length;
    player.events([{ e: 'win' }]);
    const end = Math.max(...ctx.sources.filter((x) => x.startT >= 0).map((x) => x.stopT));
    const [filter, out] = [ctx.nodes[1], ctx.nodes[0]];
    expect(nodesBefore).toBeGreaterThan(1);
    player.dispose();
    expect(timers.pending.size).toBe(1); // the scheduler is stopped; only the teardown remains
    timers.run((end - ctx.currentTime) * 1000 - 50, ctx);
    expect(out.disconnected).toBe(false);
    expect(filter.disconnected).toBe(false);
    timers.run(2000, ctx);
    expect(out.disconnected).toBe(true);
    expect(filter.disconnected).toBe(true);
    expect(getTranspose()).toBe(0);
    player.dispose(); // a second dispose is a no-op
    expect(timers.pending.size).toBe(0);
  });

  it('dispose_mid_bar_fades_rather_than_hard_cuts', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(300, ctx);
    const out = ctx.gainNodes[0];
    const now = ctx.currentTime;
    player.dispose();
    expect(out.disconnected).toBe(false);
    expect(out.gain.calls.some((c) => c.kind === 'lin' && c.v === 0 && c.t > now)).toBe(true);
    timers.run(500, ctx);
    expect(out.disconnected).toBe(true);
  });

  it('starts_late_when_context_appears', () => {
    const { ctx, timers, player } = setup({ ctxNullTicks: 3 });
    players.push(player);
    player.start();
    timers.run(60, ctx); // ticks at 0, 25, 50: all without a context
    expect(ctx.oscs.length).toBe(0);
    expect(timers.pending.size).toBe(1);
    timers.run(25, ctx); // the context appears at 75 ms
    timers.run(BAR_S * 1000, ctx);
    expect(ctx.oscs.length).toBeGreaterThan(0);
    expect(Math.min(...ctx.oscs.map((o) => o.startT))).toBeLessThanOrEqual(0.075 + BAR_S);
  });

  it('filter_tracks_danger_smoothly', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(0, ctx);
    const lp = ctx.filters[0].frequency;
    player.setMood({ tier: 2, danger: 1 });
    expect(last(lp.calls)).toMatchObject({ kind: 'target', v: 1000 });
    player.setMood({ tier: 1, danger: 0.5 });
    expect(last(lp.calls)).toMatchObject({ kind: 'target', v: 4500 });
    player.setMood({ tier: 3, danger: 0.2 });
    expect(last(lp.calls)).toMatchObject({ kind: 'target', v: 1200 });
    expect(lp.calls.some((c) => c.kind === 'set' || c.kind === 'lin')).toBe(false);
  });

  it('identical_moods_add_no_automation', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(0, ctx);
    const lp = ctx.filters[0].frequency;
    const n = lp.calls.length;
    for (let i = 0; i < 60; i++) player.setMood({ tier: 1, danger: 0.3 + i * 1e-5 });
    expect(lp.calls.length - n).toBeLessThanOrEqual(1);
    player.setMood({ tier: 2, danger: 0.3 }); // a tier change always retargets
    expect(lp.calls.length - n).toBe(2);
  });

  it('quick_pause_resume_keeps_the_bar_grid', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(BAR_S * 1000 * 0.5, ctx); // mid bar 0; bar 1 not composed yet
    const bar1 = 0.05 + BAR_S;
    player.pause();
    timers.run(200, ctx);
    const from = ctx.oscs.length;
    player.resume();
    timers.run(BAR_S * 1000, ctx);
    const fresh = ctx.oscs.slice(from);
    expect(fresh.length).toBeGreaterThan(0);
    for (const o of fresh) expect(o.startT).toBeGreaterThanOrEqual(bar1 - 1e-9);
  });

  it('stingers_follow_the_grid_after_a_re_anchor', () => {
    const run = (capture: boolean) => {
      const { ctx, timers, player } = setup();
      players.push(player);
      player.start();
      timers.run(500, ctx);
      player.pause();
      timers.run(7_300, ctx); // long enough that the grid re-anchors on resume
      player.resume();
      timers.run(BAR_S * 1000 * 0.3, ctx);
      const at = ctx.currentTime;
      const from = ctx.oscs.length;
      if (capture) player.events([{ e: 'capture' }]);
      timers.run(400, ctx); // still inside the same bar
      return { at, starts: ctx.oscs.slice(from).map((o) => o.startT) };
    };
    // The stinger's voices are what the capture run built beyond the same run without it.
    const base = run(false), withCapture = run(true);
    const now = withCapture.at;
    const starts = withCapture.starts.slice();
    for (const t of base.starts) {
      const i = starts.findIndex((x) => Math.abs(x - t) < 1e-9);
      if (i >= 0) starts.splice(i, 1);
    }
    starts.sort((a, b) => a - b);
    expect(starts.length).toBeGreaterThan(0);
    const stepS = stepSeconds(BPM.normal);
    expect(starts[0]).toBeGreaterThanOrEqual(now - 1e-9);
    expect(starts[0]).toBeLessThanOrEqual(now + 2 * stepS + 1e-9); // the next 8th, not a stale grid
    // Stinger notes sit on the re-anchored 8th grid: the next bar starts on it too.
    const resumedAt = 7.8;
    const grid = (t: number) => ((t - (resumedAt + 0.05)) / (2 * stepS)) % 1;
    for (const t of starts) expect(Math.min(grid(t), 1 - grid(t))).toBeLessThan(1e-6);
  });

  it('revive_during_tape_stop_holds_instead_of_jumping', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(100, ctx);
    const out = ctx.gains[0];
    player.events([{ e: 'down' }]);
    timers.run(300, ctx); // mid tape stop
    const n = out.calls.length;
    player.events([{ e: 'revive' }]);
    const after = out.calls.slice(n);
    expect(after[0]).toMatchObject({ kind: 'hold', t: 0.4 });
    expect(after.slice(1).map((c) => [c.kind, c.v])).toEqual([['lin', 0], ['lin', 1]]);
  });

  it('effects_are_in_the_round_key_from_creation', () => {
    // The round's start chime plays before start(): it must already be in the round key.
    setTranspose(0);
    const { player } = setup({ roundKey: -2 });
    players.push(player);
    expect(getTranspose()).toBe(-2);
    player.start();
    expect(getTranspose()).toBe(-2);
  });

  it('milestone_transposes_effects_on_the_next_downbeat', () => {
    const { ctx, timers, player } = setup({ roundKey: -2 });
    players.push(player);
    player.start();
    expect(getTranspose()).toBe(-2);
    timers.run(100, ctx);
    player.events([{ e: 'milestone' }]);
    // The fanfare right after the milestone stays in tune with the bar still ringing.
    expect(getTranspose()).toBe(-2);
    const bar1 = 0.05 + BAR_S;
    timers.run((bar1 - ctx.currentTime) * 1000 - 5, ctx);
    expect(getTranspose()).toBe(-2);
    timers.run(30, ctx); // the first tick at or after the downbeat
    expect(getTranspose()).toBe(-1);
    player.dispose();
    expect(getTranspose()).toBe(0);
  });

  it('milestone_lifts_from_the_next_bar_and_never_before', () => {
    // Same seed with and without the milestone; a capture in the same call is the stinger.
    const pitches = (withMilestone: boolean) => {
      const { ctx, timers, player } = setup();
      players.push(player);
      player.start();
      timers.run(BAR_S * 1000 * 0.4, ctx);
      player.events(withMilestone ? [{ e: 'capture' }, { e: 'milestone' }] : [{ e: 'capture' }]);
      timers.run(BAR_S * 1000 * 1.5, ctx);
      return ctx.oscs.map((o) => ({ t: o.startT, f: o.frequency.calls.find((c) => c.kind === 'set')!.v }));
    };
    const a = pitches(false), b = pitches(true);
    const bar1 = 0.05 + BAR_S;
    expect(b.length).toBe(a.length);
    const before = b.filter((o) => o.t < bar1 - 1e-9).length;
    expect(before).toBeGreaterThan(0);
    expect(b.length - before).toBeGreaterThan(0);
    let lifted = 0;
    for (let i = 0; i < a.length; i++) {
      expect(b[i].t).toBeCloseTo(a[i].t, 9);
      const r = b[i].f / a[i].f;
      // Nothing (bar notes or the stinger) before the next bar's downbeat uses the new key.
      if (b[i].t < bar1 - 1e-9) expect(r).toBeCloseTo(1, 9);
      else if (Math.abs(r - 1) > 1e-9) { expect(r).toBeCloseTo(2 ** (1 / 12), 6); lifted++; }
      // (fixed-pitch drum oscillators, such as the kick's, read 1 after the lift too)
    }
    expect(lifted).toBeGreaterThan(0);
  });

  it('inaudible_builds_no_voices_but_keeps_composing', () => {
    let loud = false;
    const { ctx, timers, player } = setup({ audible: () => loud });
    players.push(player);
    player.setMood({ tier: 1, danger: 0 });
    player.start();
    timers.run(2 * BAR_S * 1000, ctx);
    player.events([{ e: 'steal', size: 2 }]);
    player.events([{ e: 'down' }]); // no tape-stop glide either
    player.events([{ e: 'revive' }]);
    timers.run(2 * BAR_S * 1000, ctx);
    expect(ctx.sources.length).toBe(0);
    expect(ctx.nodes.length).toBe(2); // only the player's own filter and gain
    loud = true;
    const now = ctx.currentTime;
    timers.run(BAR_S * 1000, ctx);
    expect(ctx.oscs.length).toBeGreaterThan(0);
    // Picks up on the running grid, with no backlog of the silent bars.
    for (const s of ctx.sources) expect(s.startT).toBeGreaterThanOrEqual(now - 1e-9);
    const stepS = stepSeconds(BPM.normal);
    const onGrid = (t: number) => { const x = ((t - 0.05) / stepS) % 1; return Math.min(x, 1 - x) < 1e-6; };
    expect(ctx.oscs.filter((o) => o.startT > now + 0.2).every((o) => onGrid(o.startT))).toBe(true);
  });

  it('pause_drops_unbuilt_notes', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(BAR_S * 1000 * 0.25, ctx);
    player.pause();
    const n = ctx.sources.length;
    timers.run(10_000, ctx);
    expect(ctx.sources.length).toBe(n);
    player.resume();
    timers.run(BAR_S * 1000, ctx);
    // Nothing from before the pause is built late: every new voice starts on or after now.
    const fresh = ctx.sources.slice(n);
    expect(fresh.length).toBeGreaterThan(0);
    for (const s of fresh) expect(s.startT).toBeGreaterThanOrEqual(s.createdAt - 1e-9);
  });

  it('a_second_dispose_cuts_a_ringing_cadence_short', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(100, ctx);
    player.events([{ e: 'win' }]);
    const [out, filter] = [ctx.gainNodes[0], ctx.nodes[1]];
    player.dispose();
    timers.run(1000, ctx);
    expect(out.disconnected).toBe(false); // still ringing out
    const now = ctx.currentTime;
    player.dispose(); // a quick Play again
    expect(out.gain.calls.some((c) => c.kind === 'lin' && c.v === 0 && c.t > now && c.t <= now + 0.1 + 1e-9)).toBe(true);
    timers.run(200, ctx);
    expect(out.disconnected).toBe(true);
    expect(filter.disconnected).toBe(true);
    expect(timers.pending.size).toBe(0);
    player.dispose();
    expect(timers.pending.size).toBe(0);
  });

  it('down_is_a_tape_stop_and_revive_fades_back_in', () => {
    const { ctx, timers, player } = setup();
    players.push(player);
    player.start();
    timers.run(100, ctx);
    const lp = ctx.filters[0].frequency;
    const out = ctx.gains[0]; // the player's gain (created before any voice)
    const n = ctx.oscs.length;
    player.events([{ e: 'down' }]);
    expect(last(out.calls)).toMatchObject({ kind: 'lin', v: 0 });
    expect(last(out.calls)!.t).toBeCloseTo(0.1 + 0.8, 6);
    expect(lp.calls.some((c) => c.v === 200)).toBe(true);
    const glide = ctx.oscs.slice(n).find((o) => o.frequency.calls.some((c) => c.kind === 'exp' && c.v === 60));
    expect(glide?.frequency.calls[0]).toMatchObject({ kind: 'set', v: 300 });
    player.events([{ e: 'revive' }]);
    expect(last(out.calls)).toMatchObject({ kind: 'lin', v: 1 });
    expect(last(out.calls)!.t - out.calls[out.calls.length - 2].t).toBeCloseTo(0.5, 6);
  });
});

describe('music voices', () => {
  const LAYERS: Layer[] = ['pad', 'pluck', 'bass', 'kick', 'clap', 'hat', 'lead', 'stab', 'fill'];

  it.each(LAYERS)('voices_respect_max_gain_and_disconnect: %s', (layer) => {
    for (const vel of [1, 0.4]) {
      const ctx = new FakeCtx();
      VOICES[layer](ctx as unknown as AudioContext, bus, 0.5, 330, 0.4, vel);
      expect(ctx.sources.length).toBeGreaterThan(0);
      const audio = ctx.gainNodes.filter((g) => !g.modulates);
      const env = audio.filter((g) => g.gain.calls.length > 0);
      expect(env.length).toBeGreaterThan(0);
      // Envelopes feeding the same node play in parallel: their peaks together stay under the cap.
      const byTarget = new Map<unknown, number>();
      for (const g of env) {
        const p = Math.max(...g.gain.calls.map((c) => c.v));
        for (const to of g.targets) byTarget.set(to, (byTarget.get(to) ?? 0) + p);
        expect(g.gain.calls[0]).toMatchObject({ kind: 'set', t: 0.5 }); // starts at the scheduled time
      }
      for (const sum of byTarget.values()) expect(sum).toBeLessThanOrEqual(MAX_GAIN * vel + 1e-12);
      // Mix gains (set by value) never add up above unity.
      for (const g of audio) expect(g.gain.value).toBeLessThanOrEqual(1);
      for (const s of ctx.sources) expect(s.startT).toBeGreaterThanOrEqual(0.5);
      ctx.advance(10);
      for (const node of ctx.nodes) expect(node.disconnected).toBe(true);
    }
  });

  it('voices_sit_where_phones_hear_them', () => {
    // Pitched layers stay at or above 150 Hz for a C3-ish note except the bass's triangle
    // fundamental (its 2× sine carries it) and the kick's body (its 2 kHz click carries it).
    const ctx = new FakeCtx();
    VOICES.kick(ctx as unknown as AudioContext, bus, 0, 440, 0.1, 1);
    expect(ctx.oscs.some((o) => o.frequency.calls[0].v >= 1800)).toBe(true);
    const b = new FakeCtx();
    VOICES.bass(b as unknown as AudioContext, bus, 0, 110, 0.3, 1);
    expect(b.oscs.some((o) => o.frequency.calls[0].v === 220)).toBe(true);
    const f = new FakeCtx();
    VOICES.fill(f as unknown as AudioContext, bus, 0, 440, 0.1, 1);
    for (const o of f.oscs) expect(o.frequency.calls[0].v).toBeGreaterThanOrEqual(150);
  });
});
