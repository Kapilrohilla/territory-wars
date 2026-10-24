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
}
class FakeNode {
  disconnected = false;
  /** Set when this node drives an AudioParam (a modulator, not part of the audio path). */
  modulates = false;
  connect(to?: unknown) { if (to instanceof FakeParam) this.modulates = true; }
  disconnect() { this.disconnected = true; }
}
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  startT = -1;
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
  createOscillator() { const o = this.track(new FakeSource()); this.oscs.push(o); this.sources.push(o); return o; }
  createBufferSource() { const s = this.track(new FakeSource()); this.sources.push(s); return s; }
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

function setup(opts: { roundKey?: number; ctxNullTicks?: number } = {}) {
  const ctx = new FakeCtx();
  const timers = new FakeTimers();
  let nullTicks = opts.ctxNullTicks ?? 0;
  const player = createMusicPlayer({
    difficulty: 'normal', seed: 42, roundKey: opts.roundKey ?? 0,
    ctx: () => (nullTicks-- > 0 ? null : (ctx as unknown as AudioContext)),
    bus: () => bus,
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
    player.start();
    timers.run(0, ctx);
    expect(ctx.oscs.length).toBeGreaterThan(0);
    for (const o of ctx.oscs) expect(o.startT).toBeLessThanOrEqual(0.12 + BAR_S);
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
    expect(maxQueued).toBeLessThan(256); // at most about a bar of notes queued ahead
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
    expect(timers.pending.size).toBe(0);
    expect(() => { player.events([{ e: 'steal' }]); player.setMood({ tier: 1, danger: 0 }); player.resume(); }).not.toThrow();
    timers.run(5000, ctx);
    expect(count()).toBe(n);
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

  it('milestone_transposes_effects', () => {
    const { ctx, timers, player } = setup({ roundKey: -2 });
    players.push(player);
    player.start();
    expect(getTranspose()).toBe(-2);
    timers.run(100, ctx);
    player.events([{ e: 'milestone' }]);
    expect(getTranspose()).toBe(-1);
    player.dispose();
    expect(getTranspose()).toBe(0);
  });

  it('milestone_lifts_the_next_bar_by_a_semitone', () => {
    const pitches = (withMilestone: boolean) => {
      const { ctx, timers, player } = setup();
      players.push(player);
      player.start();
      timers.run(100, ctx);
      if (withMilestone) player.events([{ e: 'milestone' }]);
      const from = ctx.oscs.length;
      timers.run(BAR_S * 1000, ctx);
      return ctx.oscs.slice(from).map((o) => o.frequency.calls.find((c) => c.kind === 'set')!.v);
    };
    const a = pitches(false), b = pitches(true);
    expect(b.length).toBe(a.length);
    expect(b.length).toBeGreaterThan(0);
    for (let i = 0; i < a.length; i++) expect(b[i] / a[i]).toBeCloseTo(2 ** (1 / 12), 6);
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
      const audio = ctx.gainNodes.filter((g) => !g.modulates).map((g) => g.gain);
      const env = audio.filter((g) => g.calls.length > 0);
      expect(env.length).toBeGreaterThan(0);
      for (const g of env) {
        expect(Math.max(...g.calls.map((c) => c.v))).toBeLessThanOrEqual(MAX_GAIN * vel + 1e-12);
        expect(g.calls[0]).toMatchObject({ kind: 'set', t: 0.5 }); // starts at the scheduled time
      }
      // Mix gains (set by value) never add up above unity.
      for (const g of audio) expect(g.value).toBeLessThanOrEqual(1);
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
