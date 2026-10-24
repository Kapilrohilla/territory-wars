/**
 * The adaptive music player: turns the composer's notes into sound on the AudioContext clock.
 * A 25 ms timer composes each bar just in time (only once its start is within 0.12 s) and
 * schedules its notes through a per-player lowpass and gain into the music bus. It owns the
 * effect transpose (round key + the composer's milestone lifts), filters the music with danger,
 * does a "tape stop" when the player goes down and fades back in on revive.
 */
import type { Difficulty } from '../../sim/config';
import { MAX_GAIN, audioContext, musicBus, setTranspose } from '../sound';
import { createComposer, type MusicEvent, type MusicMood, type NoteEv } from './composer';
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
/** How far ahead (s) a bar must start before it is composed and scheduled. */
const HORIZON_S = 0.12;
/** Lead time (s) before the first bar after start or resume, so its first note isn't late. */
const LEAD_S = 0.05;
const FILTER_TC = 0.3;
const PAUSE_FADE_S = 0.15;
const DOWN_S = 0.8;
const DOWN_CUTOFF = 200;
const REVIVE_FADE_S = 0.5;

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
  timers?: Timers;
}): MusicPlayer {
  const getCtx = opts.ctx ?? audioContext;
  const getBus = opts.bus ?? musicBus;
  const timers = opts.timers ?? defaultTimers;
  const roundKey = opts.roundKey ?? 0;
  const stepS = stepSeconds(BPM[opts.difficulty]);
  const barS = STEPS_PER_BAR * stepS;
  const composer = createComposer({ seed: opts.seed });

  let started = false;
  let paused = false;
  let disposed = false;
  let timer: number | null = null;
  let mood: MusicMood = { tier: 0, danger: 0 };
  let c: AudioContext | null = null;
  let filter: BiquadFilterNode | null = null;
  let out: GainNode | null = null;
  /** Context time of step 0; moved forward after a pause or a stall so bars never pile up. */
  let t0 = 0;
  let nextBar = 0;
  /** The cutoff (and tier) the filter was last aimed at, so per-frame setMood calls stay cheap. */
  let aimed = { cutoff: 0, tier: -1 };

  const barStart = (i: number) => t0 + i * barS;
  const stepTime = (step: number) => t0 + step * stepS;
  const applyTranspose = () => setTranspose(roundKey + composer.keyOffset);

  /** Re-anchors the clock so the next uncomposed bar starts shortly after now. */
  function anchor(now: number): void {
    t0 = now + LEAD_S - nextBar * barS;
  }

  function play(notes: NoteEv[], now: number): void {
    if (!c || !filter) return;
    // Read per call: a milestone lifts everything scheduled from here on, not what's already queued.
    const key = roundKey + composer.keyOffset;
    for (const n of notes) {
      const freq = 440 * 2 ** ((n.semi + key) / 12);
      try {
        VOICES[n.layer](c, filter, Math.max(now, stepTime(n.step)), freq, n.dur * stepS, n.vel);
      } catch { /* a voice failing must never stop the music */ }
    }
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
    aimed = { cutoff: cutoffFor(mood), tier: mood.tier };
    filter.Q.value = 0.7;
    filter.connect(out);
    out.connect(bus);
    anchor(ctx.currentTime);
    return true;
  }

  function schedule(): void {
    if (!c) return;
    const now = c.currentTime;
    // After a stall (a throttled background tab) restart from the next bar rather than catch up.
    if (barStart(nextBar) < now) anchor(now);
    while (barStart(nextBar) < now + HORIZON_S) {
      play(composer.bar(nextBar), now);
      nextBar++;
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
    if (!bus) return;
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
    aimed = { cutoff: cutoffFor(mood), tier: mood.tier };
  }

  return {
    get playing() { return started && !paused && !disposed; },

    start() {
      if (started || disposed) return;
      started = true;
      applyTranspose();
      tick();
    },

    pause() {
      if (!started || paused || disposed) return;
      paused = true;
      stopTimer();
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
        // The rest of the bar playing when we paused is still queued: keep the grid unless the next
        // bar's start has already slipped by, so the next bar never lands on top of those notes.
        const now = c.currentTime;
        const late = barStart(nextBar) < now + LEAD_S;
        if (late) anchor(now);
        if (composer.state === 'playing') fadeIn(late ? barStart(nextBar) : now, LEAD_S);
      }
      tick();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      filter?.disconnect();
      out?.disconnect();
      filter = null;
      out = null;
      c = null;
      setTranspose(0);
    },

    setMood(m) {
      mood = { tier: m.tier, danger: m.danger };
      composer.setMood(mood);
      if (!c || !filter || paused || disposed || composer.state !== 'playing') return;
      const cutoff = cutoffFor(mood);
      if (mood.tier === aimed.tier && Math.abs(cutoff - aimed.cutoff) <= aimed.cutoff * RETARGET_FRAC) return;
      aimed = { cutoff, tier: mood.tier };
      filter.frequency.setTargetAtTime(cutoff, c.currentTime, FILTER_TC);
    },

    events(list) {
      // Dropped while paused: the game sim is frozen then, so no real cues arrive.
      if (!started || paused || disposed || composer.state === 'ended' || list.length === 0) return;
      const before = composer.state;
      const now = c?.currentTime ?? 0;
      const notes = composer.events(list, c ? (now - t0) / stepS : 0);
      applyTranspose();
      if (!c) return; // no context yet: the composer still hears milestones, nothing sounds
      if (before === 'playing' && composer.state === 'down') tapeStop(now);
      else if (before === 'down' && composer.state === 'playing') fadeIn(barStart(nextBar), REVIVE_FADE_S);
      play(notes, now);
    },
  };
}
