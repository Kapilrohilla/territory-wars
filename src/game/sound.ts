/**
 * Synthesized sound effects (no audio files). One shared AudioContext,
 * created lazily inside a user gesture (`unlockAudio`) so browsers allow
 * playback. Every call silently no-ops when WebAudio is unavailable, blocked
 * or muted.
 */
import type { Difficulty } from '../sim/config';
import type { Vec } from '../sim/geometry';
import {
  getDirectional, getMusicVolume as storedMusicVolume, getSfxVolume, setDirectional as storeDirectional,
  setMusicVolume as storeMusicVolume, setSfxVolume,
} from '../ui/settings';

export type SoundName =
  | 'capture'    // you closed a loop (scaled by `pct`)
  | 'steal'      // that loop took land from a rival
  | 'cut'        // you cut a rival's trail (their trail starts burning)
  | 'kill'       // a rival you hit was knocked out (pitched up by `streak`)
  | 'burning'    // your own trail was cut and is burning toward you
  | 'escape'     // you made it home and the burn went out
  | 'down'       // you were knocked out
  | 'revive'     // you came back (the shield goes up)
  | 'shieldDown' // the revive shield wore off
  | 'milestone'  // you first passed 10 / 25 / 50 % this round (`tier` 0..2)
  | 'start'      // a round begins
  | 'win'
  | 'gameover'
  | 'newBest'
  | 'heartbeat'  // tension layer: a soft lub-dub (`gain` from tension.ts beatGain)
  | 'crackle'    // tension layer: an ember crackle while your trail burns (`level` = burn progress)
  | 'alert'      // a rival just became the closest threat to your trail (threats.ts)
  | 'overtake';  // you passed a rival on the leaderboard

export type SoundOpts = {
  /** capture: land gained, in % of the arena. */
  pct?: number;
  /** capture: length (s) of the rising sweep under the chord, matching the capture wave (waves.ts). */
  durationS?: number;
  /** kill: how many quick kills came before this one (0..4), one scale step each. */
  streak?: number;
  /** milestone: 0, 1, 2 for 10 %, 25 %, 50 %. */
  tier?: number;
  /** crackle: burn progress (0..1), a little louder as the burn nears. */
  level?: number;
  /** heartbeat: peak gain of the main thump (the caller scales it with danger). */
  gain?: number;
  /** Seconds to wait before the sound starts (to sequence sounds in one step). */
  delay?: number;
  /**
   * Where it happened in the world. With a listener set (setListener) the cue is panned
   * toward its side of the screen and, when off-screen, quieter with distance.
   */
  at?: Vec;
};

/** Every voice stays under this peak gain. */
export const MAX_GAIN = 0.09;

const MUTE_KEY = 'territory-wars.muted';
/** Master gain when unmuted (the sound effects and music volumes sit on their own buses). */
export const MASTER_GAIN = 0.9;
/** Music bus gain at 100 % music volume: the music sits under the effects. */
export const MUSIC_GAIN = 0.5;
/** Music transposes by at most this many semitones, down and up. */
const TRANSPOSE_MIN = -3;
const TRANSPOSE_MAX = 4;
/** Stereo spread: an event at the screen edge pans this far (not hard left/right). */
export const PAN_MAX = 0.7;
/** Positioned cues quieter than this (far off-screen) are not played at all. */
const MIN_SPATIAL_GAIN = 0.01;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Every effect voice goes through this bus (the sound effects volume). */
let sfxBus: GainNode | null = null;
/** The music's own bus (MUSIC_GAIN × the music volume), a sibling of the SFX bus. */
let musicNode: GainNode | null = null;
let failed = false;
/** Added to every voice's start time while a sound is being built (SoundOpts.delay). */
let offset = 0;
let muted = loadMuted();
/** The sound effects volume as a 0..1 gain on the SFX bus (the 0–100 slider / 100). */
let volume = volumeToGain(getSfxVolume());
/** The music volume as a 0..1 factor on MUSIC_GAIN. */
let musicVolume = volumeToGain(storedMusicVolume());
/** Semitones added to every pitched effect (see note), set by the music's key. */
let transpose = 0;
let directional = getDirectional();

type AudioCtor = { new (): AudioContext };

function loadMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try { globalThis.localStorage?.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* storage unavailable */ }
  applyMaster();
}

/** The 0–100 volume slider as a gain factor 0..1 (linear, clamped; NaN → the 80 default). */
export function volumeToGain(v: number): number {
  if (!Number.isFinite(v)) return 0.8;
  return v <= 0 ? 0 : v >= 100 ? 1 : v / 100;
}

/** The master gain now: 0 when muted, else MASTER_GAIN. */
export function masterLevel(): number {
  return muted ? 0 : MASTER_GAIN;
}

/** The music bus gain now: MUSIC_GAIN × the music volume. */
function musicLevel(): number {
  return MUSIC_GAIN * musicVolume;
}

function applyMaster(): void {
  if (master && ctx) master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.02);
}

function applyBuses(): void {
  if (ctx && sfxBus) sfxBus.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  if (ctx && musicNode) musicNode.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.02);
}

/** Current sound effects volume, 0–100. */
export function getVolume(): number {
  return Math.round(volume * 100);
}

/** Sets (and saves) the sound effects volume, 0–100. Mute still overrides it. */
export function setVolume(v: number): void {
  volume = volumeToGain(v);
  setSfxVolume(v);
  applyBuses();
}

/** Current music volume, 0–100. */
export function getMusicVolume(): number {
  return Math.round(musicVolume * 100);
}

/** Sets (and saves) the music volume, 0–100. Mute still overrides it. */
export function setMusicVolume(v: number): void {
  musicVolume = volumeToGain(v);
  storeMusicVolume(v);
  applyBuses();
}

/** Shifts every pitched effect by `semis` (clamped to −3..4), so the effects follow the music's key. */
export function setTranspose(semis: number): void {
  transpose = Number.isFinite(semis) ? Math.min(TRANSPOSE_MAX, Math.max(TRANSPOSE_MIN, semis)) : 0;
}

export function getTranspose(): number {
  return transpose;
}

/** The shared AudioContext, or null before unlockAudio (or where WebAudio is unavailable). */
export function audioContext(): AudioContext | null {
  return ctx;
}

/** Where the music plays; null until the audio is unlocked. */
export function musicBus(): GainNode | null {
  return musicNode;
}

let duckTimer: ReturnType<typeof setTimeout> | null = null;
const DUCK_HOLD_MS = 100;

/** Cancels the param's automation after `t`, keeping its current value (mid-ramp included). */
function holdParam(p: AudioParam, t: number): void {
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

/**
 * Briefly dips the music (to 0.6x, back within 0.25 s) so a big effect cuts through it. A new
 * duck replaces the one in flight, and the restore reads the live music level when it is
 * scheduled, so a slider change during the dip isn't reverted.
 */
export function duckMusic(): void {
  if (!ctx || !musicNode) return;
  const node = musicNode;
  const c = ctx;
  holdParam(node.gain, c.currentTime);
  node.gain.setTargetAtTime(musicLevel() * 0.6, c.currentTime, 0.015);
  if (duckTimer !== null) clearTimeout(duckTimer);
  duckTimer = setTimeout(() => {
    duckTimer = null;
    holdParam(node.gain, c.currentTime);
    node.gain.setTargetAtTime(musicLevel(), c.currentTime, 0.04);
  }, DUCK_HOLD_MS);
}

export function isDirectional(): boolean {
  return directional;
}

/** Turns (and saves) directional sound; off, every cue plays centred. */
export function setDirectional(on: boolean): void {
  directional = on;
  storeDirectional(on);
}

// ---------- directional sound ----------

/** What a positioned cue is heard against: the camera (screen space) and the human's head. */
export type ListenerView = { viewW: number; viewH: number; worldToScreen(p: Vec): Vec };
let listenerView: ListenerView | null = null;
let listenerHead: (() => Vec) | null = null;

/**
 * Sets what positioned cues are heard from (the session's camera and the human's head), or
 * clears it with null; without one every cue plays centred at full level.
 */
export function setListener(view: ListenerView | null, head?: () => Vec): void {
  listenerView = view;
  listenerHead = view && head ? head : null;
}

/** The view a listener was set with (so a session only clears its own). */
export function currentListener(): ListenerView | null {
  return listenerView;
}

/** Stereo pan for a screen x: clamp((x − w/2)/(w/2), −1, 1) · PAN_MAX; 0 when degenerate. */
export function panFor(screenX: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(screenX)) return 0;
  const half = width / 2;
  const u = (screenX - half) / half;
  return (u < -1 ? -1 : u > 1 ? 1 : u) * PAN_MAX;
}

/** Level of an off-screen event `d` world units from the head: clamp01(1.4 − d/60). */
export function distanceGain(d: number): number {
  return clamp01(1.4 - d / 60);
}

/**
 * How a cue at world point `at` sounds: panned by its screen x (0 with directional off) and,
 * only when it is off-screen, attenuated by its world distance from the head.
 */
export function spatialFor(at: Vec, view: ListenerView, head: Vec, dir: boolean): { pan: number; gain: number } {
  const s = view.worldToScreen(at);
  const onScreen = s.x >= 0 && s.x <= view.viewW && s.y >= 0 && s.y <= view.viewH;
  return {
    pan: dir ? panFor(s.x, view.viewW) : 0,
    gain: onScreen ? 1 : distanceGain(Math.hypot(at.x - head.x, at.y - head.y)),
  };
}

/**
 * Wires master to the speakers through a gentle limiter (−10 dB threshold, soft 6 dB knee,
 * 4:1, fast attack), so stacked cues (capture chord + relief + fanfare + kill) can't clip.
 * Without createDynamicsCompressor (old engines, test fakes) master goes straight out.
 * Returns the limiter, or null.
 */
/** Cancels the limiter's automatic makeup gain (≈ −4.5 dB). */
export const LIMITER_TRIM = 0.6;

export function connectMaster(c: AudioContext, m: GainNode): DynamicsCompressorNode | null {
  if (typeof c.createDynamicsCompressor !== 'function') {
    m.connect(c.destination);
    return null;
  }
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -10;
  lim.knee.value = 6;
  lim.ratio.value = 4;
  lim.attack.value = 0.003;
  lim.release.value = 0.15;
  // The spec gives every compressor automatic makeup gain (about +4.5 dB at these
  // settings); trim it back so the limiter only catches pile-ups, not the whole mix.
  const trim = c.createGain();
  trim.gain.value = LIMITER_TRIM;
  m.connect(lim);
  lim.connect(trim);
  trim.connect(c.destination);
  return lim;
}

/** Call from a user-gesture handler (a click or key press). Safe to call repeatedly. */
export function unlockAudio(): void {
  if (failed) return;
  try {
    if (!ctx) {
      const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) { failed = true; return; }
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      connectMaster(ctx, master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = volume;
      sfxBus.connect(master);
      musicNode = ctx.createGain();
      musicNode.gain.value = musicLevel();
      musicNode.connect(master);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    failed = true;
    ctx = null;
    master = null;
    sfxBus = null;
    musicNode = null;
  }
}

// ---------- synth primitives ----------

type ToneOpts = {
  type?: OscillatorType;
  f0: number;
  /** End frequency (exponential glide); omit for a steady pitch. */
  f1?: number;
  dur: number;
  gain: number;
  delay?: number;
  attack?: number;
};

function tone(c: AudioContext, out: AudioNode, o: ToneOpts): void {
  const t = c.currentTime + offset + (o.delay ?? 0);
  const attack = o.attack ?? 0.006;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  // Short attack and exponential release so nothing clicks.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.min(o.gain, MAX_GAIN), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}

type NoiseOpts = {
  dur: number;
  gain: number;
  delay?: number;
  /** Filter frequency, gliding to `freqEnd` over the sound when given. */
  freq: number;
  freqEnd?: number;
  q?: number;
  type?: BiquadFilterType;
  /** Pulse the loudness with a smooth sine tremolo at this rate (Hz). */
  pulseHz?: number;
  /** Fade-in time (s); 4 ms when unset. */
  attack?: number;
};

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext, out: AudioNode, o: NoiseOpts): void {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + offset + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true; // the buffer is 0.5 s; longer sounds (the capture sweep) loop it
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.min(o.gain, MAX_GAIN), t + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f);
  f.connect(g);
  const nodes: AudioNode[] = [src, f, g];
  if (o.pulseHz) {
    // Tremolo: a sine LFO swings the gain of `trem` between 0 and 1 (no hard edges).
    const trem = c.createGain();
    trem.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = o.pulseHz;
    const depth = c.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(trem.gain);
    g.connect(trem);
    trem.connect(out);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.02);
    nodes.push(trem, lfo, depth);
  } else {
    g.connect(out);
  }
  src.start(t);
  src.stop(t + o.dur + 0.02);
  src.onended = () => { for (const n of nodes) n.disconnect(); };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Notes as semitones above A4 (440 Hz), shifted by the current transpose. */
const note = (semi: number) => 440 * 2 ** ((semi + transpose) / 12);

// ---------- the sounds ----------

/** Do-re-mi-fa-sol: the kill chirp climbs one step per quick follow-up kill. */
export const STREAK_STEPS = [0, 2, 4, 5, 7];
export const MAX_STREAK = STREAK_STEPS.length - 1;

/**
 * The notes (semitones above A4) of a capture of `pct` % of the arena: one soft note
 * for a nibble, a rising pair for a decent bite, a rising major-triad run above 3 %.
 */
export function captureNotes(pct: number): number[] {
  if (pct > 3) return [3, 7, 10];
  if (pct >= 1) return [3, 10];
  return [3];
}

/** Rising major arpeggios for the 10 / 25 / 50 % milestones; each tier is longer and higher. */
const MILESTONE_RUNS = [[3, 7, 10, 15], [5, 9, 12, 17], [7, 11, 14, 19, 26]];

type Synth = (c: AudioContext, out: AudioNode, o: SoundOpts) => void;

const SOUNDS: Record<SoundName, Synth> = {
  capture(c, out, o) {
    const pct = o.pct ?? 0;
    const notes = captureNotes(pct);
    const big = notes.length === 3;
    // Louder (still soft) for bigger gains; each note a touch higher than the last.
    const gain = big ? 0.075 : notes.length === 2 ? 0.065 : 0.05;
    notes.forEach((s, i) => {
      const f = note(s);
      tone(c, out, { f0: f, f1: f * 1.03, dur: i === notes.length - 1 ? 0.16 : 0.09, gain, delay: i * 0.065 });
      tone(c, out, { type: 'triangle', f0: f * 2, dur: 0.06, gain: gain * 0.3, delay: i * 0.065 });
    });
    if (big) {
      // Sparkle: a twinkle of high pings plus an airy shimmer over the last note.
      const at = 2 * 0.065;
      [27, 31, 34].forEach((s, i) => tone(c, out, { f0: note(s), dur: 0.08, gain: 0.025, delay: at + 0.03 + i * 0.04 }));
      noise(c, out, { dur: 0.22, gain: 0.02, freq: 7000, q: 0.6, type: 'highpass', delay: at });
    }
    const sweep = o.durationS ?? 0;
    if (sweep > 0) {
      // A rising "whoosh" as long as the wave: a soft triangle glide (C5 → C6, a touch higher
      // for bigger gains) over band-passed noise climbing 700 Hz → 3.2 kHz, all inside the
      // 150 Hz–4 kHz band phone speakers play. It swells in so the chord stays on top.
      const top = big ? 2.25 : 2;
      tone(c, out, { type: 'triangle', f0: note(3), f1: note(3) * top, dur: sweep, gain: gain * 0.45, attack: sweep * 0.5 });
      noise(c, out, { dur: sweep, gain: 0.03, freq: 700, freqEnd: 3200, q: 1.2, attack: sweep * 0.6 });
    }
  },
  steal(c, out) {
    // A quick downward "swipe": band-passed noise sweeping low plus a gritty crunch.
    noise(c, out, { dur: 0.09, gain: 0.07, freq: 1800, freqEnd: 500, q: 1.8 });
    tone(c, out, { type: 'sawtooth', f0: 320, f1: 140, dur: 0.07, gain: 0.04 });
  },
  cut(c, out) {
    // Quick "swish": a filtered noise sweep plus a bright ping.
    noise(c, out, { dur: 0.12, gain: 0.08, freq: 2400, q: 2.5 });
    tone(c, out, { type: 'triangle', f0: 1200, f1: 1600, dur: 0.1, gain: 0.05, delay: 0.02 });
  },
  kill(c, out, o) {
    // Punchy knockout: low thump, crunch, then a victory chirp that climbs with the streak.
    const k = STREAK_STEPS[Math.max(0, Math.min(MAX_STREAK, o.streak ?? 0))];
    tone(c, out, { f0: 180, f1: 55, dur: 0.2, gain: 0.09 });
    noise(c, out, { dur: 0.14, gain: 0.07, freq: 900, q: 0.8 });
    tone(c, out, { type: 'square', f0: note(3 + k), dur: 0.07, gain: 0.035, delay: 0.09 });
    tone(c, out, { type: 'square', f0: note(10 + k), dur: 0.11, gain: 0.035, delay: 0.15 });
  },
  burning(c, out) {
    // Warning sizzle: a crackling hiss whose loudness pulses fast, under two urgent beeps.
    noise(c, out, { dur: 0.36, gain: 0.05, freq: 3600, q: 0.7, type: 'highpass', pulseHz: 14 });
    tone(c, out, { type: 'square', f0: note(15), f1: note(12), dur: 0.08, gain: 0.04 });
    tone(c, out, { type: 'square', f0: note(15), f1: note(12), dur: 0.08, gain: 0.04, delay: 0.12 });
  },
  escape(c, out) {
    // Relieved "safe!": a falling-then-resolving two-note chime with a soft bell overtone.
    tone(c, out, { type: 'triangle', f0: note(10), dur: 0.12, gain: 0.06 });
    tone(c, out, { f0: note(15), dur: 0.26, gain: 0.06, delay: 0.09 });
    tone(c, out, { f0: note(27), dur: 0.2, gain: 0.015, delay: 0.09 });
  },
  down(c, out) {
    // Sad descending "wah-wah".
    tone(c, out, { type: 'triangle', f0: note(-2), f1: note(-4), dur: 0.2, gain: 0.08 });
    tone(c, out, { type: 'triangle', f0: note(-5), f1: note(-7), dur: 0.2, gain: 0.08, delay: 0.2 });
    tone(c, out, { type: 'triangle', f0: note(-9), f1: note(-14), dur: 0.4, gain: 0.08, delay: 0.4 });
  },
  revive(c, out) {
    // Power-up: a rising sweep under a quick upward arpeggio and a shimmer.
    tone(c, out, { type: 'sawtooth', f0: note(-12), f1: note(12), dur: 0.32, gain: 0.025, attack: 0.04 });
    [0, 4, 7, 12, 16].forEach((s, i) =>
      tone(c, out, { f0: note(s + 3), dur: 0.14, gain: 0.05, delay: 0.04 + i * 0.05 }));
    noise(c, out, { dur: 0.3, gain: 0.025, freq: 6000, q: 0.5, type: 'highpass', delay: 0.1 });
  },
  shieldDown(c, out) {
    // Soft power-down: a gentle falling glide, like the shield fizzing out.
    tone(c, out, { type: 'triangle', f0: note(10), f1: note(-2), dur: 0.26, gain: 0.04, attack: 0.02 });
    noise(c, out, { dur: 0.18, gain: 0.012, freq: 4000, freqEnd: 1200, q: 0.8 });
  },
  milestone(c, out, o) {
    // Short fanfare; the last note rings a little longer.
    const run = MILESTONE_RUNS[Math.max(0, Math.min(MILESTONE_RUNS.length - 1, o.tier ?? 0))];
    run.forEach((s, i) => {
      const last = i === run.length - 1;
      tone(c, out, { type: 'square', f0: note(s), dur: last ? 0.3 : 0.09, gain: 0.03, delay: i * 0.08 });
      tone(c, out, { f0: note(s + 12), dur: last ? 0.3 : 0.1, gain: 0.03, delay: i * 0.08 });
    });
  },
  start(c, out) {
    // "Ready… go!": two short ticks then a bright rising chord.
    tone(c, out, { type: 'triangle', f0: note(3), dur: 0.08, gain: 0.06 });
    tone(c, out, { type: 'triangle', f0: note(3), dur: 0.08, gain: 0.06, delay: 0.12 });
    tone(c, out, { type: 'triangle', f0: note(10), f1: note(15), dur: 0.28, gain: 0.08, delay: 0.24 });
    tone(c, out, { f0: note(15), f1: note(22), dur: 0.28, gain: 0.04, delay: 0.24 });
  },
  win(c, out) {
    // Little fanfare.
    const seq: [number, number][] = [[3, 0], [7, 0.12], [10, 0.24], [15, 0.36], [15, 0.6]];
    seq.forEach(([s, d], i) =>
      tone(c, out, { type: 'square', f0: note(s), dur: i === seq.length - 1 ? 0.5 : 0.12, gain: 0.04, delay: d }));
    seq.forEach(([s, d]) => tone(c, out, { f0: note(s + 12), dur: 0.14, gain: 0.025, delay: d }));
  },
  gameover(c, out) {
    // Soft closing cadence, gentler than "down".
    tone(c, out, { type: 'triangle', f0: note(-5), dur: 0.2, gain: 0.07 });
    tone(c, out, { type: 'triangle', f0: note(-9), dur: 0.2, gain: 0.07, delay: 0.18 });
    tone(c, out, { type: 'triangle', f0: note(-12), dur: 0.45, gain: 0.07, delay: 0.36 });
  },
  newBest(c, out) {
    // Twinkly shimmer.
    [12, 19, 24, 19, 24, 31].forEach((s, i) =>
      tone(c, out, { f0: note(s), dur: 0.12, gain: 0.04, delay: i * 0.07 }));
  },
  heartbeat(c, out, o) {
    // Soft "lub-dub" 0.12 s apart. A steady sub thump gives body on headphones; small phone
    // speakers can't play ~50 Hz, so a short 150–300 Hz knock (a triangle partial plus a
    // low-passed noise thud) carries it there.
    const g = o.gain ?? 0.04;
    const beat = (at: number, sub: number, knock: number, k: number) => {
      tone(c, out, { f0: sub, dur: 0.16, gain: g * k, attack: 0.012, delay: at });
      tone(c, out, { type: 'triangle', f0: knock, dur: 0.09, gain: g * 0.9 * k, attack: 0.008, delay: at });
      tone(c, out, { f0: knock * 1.5, dur: 0.06, gain: g * 0.35 * k, attack: 0.008, delay: at });
      noise(c, out, { dur: 0.07, gain: g * 0.8 * k, freq: knock + 60, q: 1.4, type: 'lowpass', delay: at });
    };
    beat(0, 55, 190, 1);
    beat(0.12, 48, 165, 0.8);
  },
  crackle(c, out, o) {
    // A tiny burst of band-passed noise at a random pitch, a little louder as the burn nears.
    const p = clamp01(o.level ?? 0);
    noise(c, out, { dur: 0.035 + Math.random() * 0.03, gain: 0.045 + 0.03 * p, freq: 1600 + Math.random() * 2400, q: 2 });
  },
  alert(c, out) {
    // A quick rising "bip-bip" (B5 then E6) with a soft octave-down body, all inside the
    // 150 Hz–4 kHz band small phone speakers play well.
    [[14, 0, 0.07], [19, 0.09, 0.11]].forEach(([s, at, dur]) => {
      tone(c, out, { type: 'triangle', f0: note(s), dur, gain: 0.055, attack: 0.005, delay: at });
      tone(c, out, { f0: note(s - 12), dur, gain: 0.03, attack: 0.005, delay: at });
    });
  },
  overtake(c, out) {
    // A soft rising tick: two quick triangle blips (E5 then A5), inside the phone-speaker band.
    [[7, 0, 0.06], [12, 0.055, 0.09]].forEach(([s, at, dur]) =>
      tone(c, out, { type: 'triangle', f0: note(s), f1: note(s) * 1.04, dur, gain: 0.045, attack: 0.005, delay: at }));
  },
};

/** Difficulty pick: a soft click whose pitch rises Easy → Normal → Hard. */
const SELECT_SEMI: Record<Difficulty, number> = { easy: -5, normal: 2, hard: 9 };

/** Longest any one sound rings past its start (s), beyond a capture sweep's own length. */
const SOUND_TAIL_S = 1.5;

/**
 * Where a positioned cue's voices go: a per-cue gain (distance) into a StereoPannerNode
 * into the SFX bus. Falls back to the gain alone when panners are unsupported. Returns null
 * when the cue is too far to hear. The bus is disconnected once the sound is over.
 */
function spatialBus(c: AudioContext, out: AudioNode, o: SoundOpts): AudioNode | null {
  const at = o.at;
  if (!at || !listenerView || !listenerHead) return out;
  const sp = spatialFor(at, listenerView, listenerHead(), directional);
  if (sp.gain < MIN_SPATIAL_GAIN) return null;
  const bus = c.createGain();
  bus.gain.value = sp.gain;
  let panner: StereoPannerNode | null = null;
  try {
    const make = (c as Partial<Pick<AudioContext, 'createStereoPanner'>>).createStereoPanner;
    if (make) {
      panner = make.call(c);
      panner.pan.value = sp.pan;
    }
  } catch { panner = null; /* unsupported: level only */ }
  if (panner) {
    bus.connect(panner);
    panner.connect(out);
  } else {
    bus.connect(out);
  }
  const lifeS = offset + (o.durationS ?? 0) + SOUND_TAIL_S;
  setTimeout(() => {
    try { bus.disconnect(); panner?.disconnect(); } catch { /* already gone */ }
  }, lifeS * 1000);
  return bus;
}

function play(fn: Synth, o: SoundOpts = {}): void {
  if (muted || !ctx || !sfxBus || ctx.state !== 'running') return;
  offset = Math.max(0, o.delay ?? 0);
  try {
    const out = spatialBus(ctx, sfxBus, o);
    if (out) fn(ctx, out, o);
  } catch { /* ignore */ } finally { offset = 0; }
}

export function playSound(name: SoundName, opts?: SoundOpts): void {
  play(SOUNDS[name], opts);
}

export function playSelect(d: Difficulty): void {
  play((c, out) => {
    const f = note(SELECT_SEMI[d]);
    tone(c, out, { type: 'triangle', f0: f, f1: f * 1.02, dur: 0.07, gain: 0.07 });
    noise(c, out, { dur: 0.03, gain: 0.04, freq: 3500, q: 1.5 });
    if (d === 'hard') tone(c, out, { type: 'square', f0: f * 1.5, dur: 0.06, gain: 0.02, delay: 0.05 });
  });
}

/** A quiet UI tick (colour swatches, buttons). */
export function playTick(): void {
  play((c, out) => tone(c, out, { type: 'triangle', f0: 1400, dur: 0.035, gain: 0.03 }));
}

/** One soft pluck on the music bus, so the music slider has something to preview. */
export function playMusicPreview(): void {
  if (muted || !ctx || !musicNode || ctx.state !== 'running') return;
  try {
    tone(ctx, musicNode, { type: 'triangle', f0: 440, dur: 0.18, gain: 0.08, attack: 0.01 });
  } catch { /* ignore */ }
}
