/**
 * The adaptive music player: turns the composer's notes into sound on the AudioContext clock.
 * A 25 ms timer composes each bar just in time (once its start is within 0.12 s) into a note
 * queue, and only builds a voice for a note once that note starts within 0.12 s, so no tick
 * builds a whole bar. Voices run through a per-player lowpass and gain into the music bus;
 * nothing is built while the music can't be heard. It owns the effect transpose (round key +
 * the composer's milestone lifts, switched on the downbeat of the lifted bar), filters the
 * music with danger, does a "tape stop" when the player goes down and fades back in on revive.
 */
import type { Difficulty } from '../../sim/config';
import { MAX_GAIN, audioContext, musicAudible, musicBus, setTranspose } from '../sound';
import { createComposer, type Composer, type MusicEvent, type MusicMood, type NoteEv } from './composer';
import { VOICES } from './instruments';
import { BPM, STEPS_PER_BAR, stepSeconds } from './theory';

export type MusicPlayer = {
  start(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
  setMood(m: MusicMood): void;
  events(list: { e: MusicEvent; size?: number }[]): void;
  readonly playing: boolean;
};

type Timers = { set(fn: () => void, ms: number): number; clear(id: number): void };

const TICK_MS = 25;
/** How far ahead (s) a bar is composed, and a note's voice built. */
const HORIZON_S = 0.12;
/** Lead time (s) before the first bar after start or resume, so its first note isn't late. */
const LEAD_S = 0.05;
const FILTER_TC = 0.3;
const PAUSE_FADE_S = 0.15;
const DOWN_S = 0.8;
const DOWN_CUTOFF = 200;
const REVIVE_FADE_S = 0.5;
/** Dispose mid-music: a short fade so the cut doesn't click. */
const DISPOSE_FADE_S = 0.1;
/** Slack after a queued note's end for its release before the graph is torn down. */
const TAIL_S = 0.6;
/** Composed bars whose key lift is remembered (stingers and late notes look theirs up). */
const KEEP_BAR_KEYS = 8;

/** Cancels automation after `now`, keeping the param at its current value (mid-ramp included). */
function hold(p: AudioParam, now: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
  else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
}

/** A cutoff change smaller than this fraction isn't worth a new automation event. */
const RETARGET_FRAC = 0.02;

/** Lowpass cutoff for a mood: opens fully when safe, closes with danger, tight while burning. */
export function cutoffFor(m: MusicMood): number {
  if (m.tier === 3) return 1200;
  const d = Math.min(1, Math.max(0, m.danger));
  return 8000 - 7000 * d;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
};

export function createMusicPlayer(opts: {
  difficulty: Difficulty;
  seed: number;
  roundKey?: number;
  ctx?: () => AudioContext | null;
  bus?: () => AudioNode | null;
  /** Whether the music can be heard (not muted, volume above 0); no voices are built otherwise. */
  audible?: () => boolean;
  timers?: Timers;
}): MusicPlayer {
  const getCtx = opts.ctx ?? audioContext;
  const getBus = opts.bus ?? musicBus;
  const audible = opts.audible ?? musicAudible;
  const timers = opts.timers ?? defaultTimers;
  const roundKey = opts.roundKey ?? 0;
  const stepS = stepSeconds(BPM[opts.difficulty]);
  const barS = STEPS_PER_BAR * stepS;
  const composer = createComposer({ seed: opts.seed });

  let started = false;
  let paused = false;
  let disposed = false;
  let timer: number | null = null;
  const mood: MusicMood = { tier: 0, danger: 0 };
  let c: AudioContext | null = null;
  let filter: BiquadFilterNode | null = null;
  let out: GainNode | null = null;
  /** Context time of step 0; moved forward after a pause or a stall so bars never pile up. */
  let t0 = 0;
  let nextBar = 0;
  /** Context time by which every voice built so far has finished (release included). */
  let queuedEnd = 0;
  /** The cutoff (and tier) the filter was last aimed at, so per-frame setMood calls stay cheap. */
  const aimed = { cutoff: 0, tier: -1 };
  /** Composed notes whose voices aren't built yet, in step order. */
  let queue: NoteEv[] = [];
  /** Key lift of each recently composed bar, by bar index. */
  const barKeys = new Map<number, number>();
  /** The key lift the effect transpose currently carries. */
  let effectKey = 0;
  /** A disposed player whose graph is still ringing out, until its teardown timer fires. */
  let ringing: { ctx: AudioContext; f: BiquadFilterNode; o: GainNode; timer: number | null } | null = null;

  const barStart = (i: number) => t0 + i * barS;
  const stepTime = (step: number) => t0 + step * stepS;
  const keyOf = (step: number) => barKeys.get(Math.floor(step / STEPS_PER_BAR)) ?? composer.keyOffset;

  // From creation, so the round's start chime (played before start()) is already in the round key.
  setTranspose(roundKey);

  /** Re-anchors the clock so the next uncomposed bar starts shortly after now; queued notes are dropped. */
  function anchor(now: number): void {
    t0 = now + LEAD_S - nextBar * barS;
    queue = [];
  }

  function enqueue(notes: NoteEv[]): void {
    if (notes.length === 0) return;
    const tail = queue.length ? queue[queue.length - 1].step : -Infinity;
    for (const n of notes) queue.push(n);
    if (notes[0].step < tail || notes.some((n, i) => i > 0 && n.step < notes[i - 1].step)) {
      queue.sort((a, b) => a.step - b.step);
    }
  }

  /** Builds the voices of queued notes starting before now + HORIZON_S (every queued note when `all`). */
  function flush(now: number, all = false): void {
    if (!c || !filter) return;
    const limit = now + HORIZON_S;
    const loud = audible();
    let i = 0;
    for (; i < queue.length; i++) {
      const n = queue[i];
      const at = stepTime(n.step);
      if (!all && at >= limit) break;
      if (!loud) continue; // inaudible: the note passes unbuilt
      const t = Math.max(now, at);
      queuedEnd = Math.max(queuedEnd, t + n.dur * stepS + TAIL_S);
      // The key of the bar the note sounds in, so a lift starts exactly on its downbeat.
      const freq = 440 * 2 ** ((n.semi + roundKey + keyOf(n.step)) / 12);
      try {
        VOICES[n.layer](c, filter, t, freq, n.dur * stepS, n.vel);
      } catch { /* a voice failing must never stop the music */ }
    }
    if (i === queue.length) queue.length = 0;
    else if (i > 0) queue.splice(0, i);
  }

  /** Builds the graph once a context and the music bus exist. */
  function ensureGraph(): boolean {
    if (c) return true;
    const ctx = getCtx();
    const bus = ctx ? getBus() : null;
    if (!ctx || !bus) return false;
    c = ctx;
    out = ctx.createGain();
    out.gain.value = 1;
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffFor(mood);
    aimed.cutoff = cutoffFor(mood);
    aimed.tier = mood.tier;
    filter.Q.value = 0.7;
    filter.connect(out);
    out.connect(bus);
    anchor(ctx.currentTime);
    return true;
  }

  /** Composes bars and builds voices up to the horizon, and moves the effect key on a lifted downbeat. */
  function schedule(): void {
    if (!c) return;
    const now = c.currentTime;
    // After a stall (a throttled background tab) restart from the next bar rather than catch up.
    if (barStart(nextBar) < now) anchor(now);
    while (barStart(nextBar) < now + HORIZON_S) {
      const notes = composer.bar(nextBar);
      barKeys.set(nextBar, composer.keyOffset);
      barKeys.delete(nextBar - KEEP_BAR_KEYS);
      enqueue(notes);
      nextBar++;
    }
    flush(now);
    const key = barKeys.get(Math.floor((now - t0) / barS));
    if (key !== undefined && key !== effectKey) {
      effectKey = key;
      setTranspose(roundKey + key);
    }
  }

  function tick(): void {
    timer = null;
    if (disposed || paused || !started) return;
    if (ensureGraph()) schedule();
    timer = timers.set(tick, TICK_MS);
  }

  function stopTimer(): void {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  /** Down: the music winds down like a stopping tape. */
  function tapeStop(now: number): void {
    if (!c || !out || !filter) return;
    hold(out.gain, now);
    out.gain.linearRampToValueAtTime(0, now + DOWN_S);
    hold(filter.frequency, now);
    filter.frequency.exponentialRampToValueAtTime(DOWN_CUTOFF, now + DOWN_S);
    // One low saw sliding down, straight to the bus so the fade above doesn't swallow it.
    const bus = getBus();
    if (!bus || !audible()) return;
    const o = c.createOscillator();
    const g = c.createGain();
    const lp = c.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, now);
    o.frequency.exponentialRampToValueAtTime(60, now + DOWN_S);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1500, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(MAX_GAIN * 0.35, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + DOWN_S);
    o.connect(lp);
    lp.connect(g);
    g.connect(bus);
    o.start(now);
    o.stop(now + DOWN_S + 0.02);
    o.onended = () => { o.disconnect(); lp.disconnect(); g.disconnect(); };
  }

  /** Fades the music back in over `s` from time `at` (revive: the next bar; resume: now or the next bar).
   * Holds whatever a running fade has reached rather than jumping back to its start. */
  function fadeIn(at: number, s: number): void {
    if (!c || !out || !filter) return;
    const now = c.currentTime;
    hold(out.gain, now);
    out.gain.linearRampToValueAtTime(0, Math.max(now, at));
    out.gain.linearRampToValueAtTime(1, Math.max(now, at) + s);
    hold(filter.frequency, now);
    filter.frequency.setTargetAtTime(cutoffFor(mood), Math.max(now, at), FILTER_TC);
    aimed.cutoff = cutoffFor(mood);
    aimed.tier = mood.tier;
  }

  /** Disconnects a disposed graph after `s` seconds (replacing any teardown already pending). */
  function tearDownIn(s: number): void {
    const r = ringing;
    if (!r) return;
    if (r.timer !== null) timers.clear(r.timer);
    r.timer = timers.set(() => {
      r.f.disconnect();
      r.o.disconnect();
      if (ringing === r) ringing = null;
    }, Math.max(0, s) * 1000);
  }

  /** Fades the player's output to 0 over DISPOSE_FADE_S from now. */
  function fadeOut(ctx: AudioContext, o: GainNode): void {
    const now = ctx.currentTime;
    hold(o.gain, now);
    o.gain.linearRampToValueAtTime(0, now + DISPOSE_FADE_S);
  }

  return {
    get playing() { return started && !paused && !disposed; },

    start() {
      if (started || disposed) return;
      started = true;
      setTranspose(roundKey + effectKey);
      tick();
    },

    pause() {
      if (!started || paused || disposed) return;
      paused = true;
      stopTimer();
      queue = []; // unbuilt notes go; resume keeps the bar grid
      if (c && out) {
        const now = c.currentTime;
        hold(out.gain, now);
        out.gain.linearRampToValueAtTime(0, now + PAUSE_FADE_S);
      }
    },

    resume() {
      if (!started || !paused || disposed) return;
      paused = false;
      if (c && out) {
        // Voices built before the pause may still ring: keep the grid unless the next bar's start
        // has already slipped by, so the next bar never lands on top of them.
        const now = c.currentTime;
        const late = barStart(nextBar) < now + LEAD_S;
        if (late) anchor(now);
        if (composer.state === 'playing') fadeIn(late ? barStart(nextBar) : now, LEAD_S);
      }
      tick();
    },

    dispose() {
      if (disposed) {
        // Again while the closing cadence rings out (a quick Play again): cut it short now.
        if (ringing) {
          fadeOut(ringing.ctx, ringing.o);
          tearDownIn(DISPOSE_FADE_S + 0.05);
        }
        return;
      }
      disposed = true;
      stopTimer();
      setTranspose(0);
      queue = [];
      const ctx = c;
      const f = filter;
      const o = out;
      filter = null;
      out = null;
      c = null;
      if (!ctx || !f || !o) return;
      let wait: number;
      if (composer.state === 'ended') {
        wait = queuedEnd - ctx.currentTime; // the closing cadence plays out untouched
      } else {
        fadeOut(ctx, o);
        wait = DISPOSE_FADE_S + 0.05;
      }
      // One tracked timeout tears the graph down once nothing audible is left.
      ringing = { ctx, f, o, timer: null };
      tearDownIn(wait);
    },

    setMood(m) {
      mood.tier = m.tier;
      mood.danger = m.danger;
      composer.setMood(mood);
      if (!c || !filter || paused || disposed || composer.state !== 'playing') return;
      const cutoff = cutoffFor(mood);
      if (mood.tier === aimed.tier && Math.abs(cutoff - aimed.cutoff) <= aimed.cutoff * RETARGET_FRAC) return;
      aimed.cutoff = cutoff;
      aimed.tier = mood.tier;
      filter.frequency.setTargetAtTime(cutoff, c.currentTime, FILTER_TC);
    },

    events(list) {
      // Dropped while paused: the game sim is frozen then, so no real cues arrive.
      if (!started || paused || disposed || composer.state === 'ended' || list.length === 0) return;
      const before = composer.state;
      const now = c?.currentTime ?? 0;
      const notes = composer.events(list, c ? (now - t0) / stepS : 0);
      const after = composer.state as Composer['state']; // events() may have changed it
      if (!c) return; // no context yet: the composer still hears milestones, nothing sounds
      if (before === 'playing' && after === 'down') tapeStop(now);
      else if (before === 'down' && after === 'playing') fadeIn(barStart(nextBar), REVIVE_FADE_S);
      enqueue(notes);
      // The ending builds the whole cadence now, so a dispose right after can let it ring out.
      if (after === 'ended') flush(now, true);
      else schedule();
    },
  };
}
