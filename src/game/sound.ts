/**
 * Synthesized sound effects (no audio files). One shared AudioContext,
 * created lazily inside a user gesture (`unlockAudio`) so browsers allow
 * playback. Every call silently no-ops when WebAudio is unavailable, blocked
 * or muted.
 */
import type { Difficulty } from '../sim/config';

export type SoundName =
  | 'capture'   // you closed a loop
  | 'cut'       // you cut a rival's trail (their trail starts burning)
  | 'kill'      // a rival you hit was knocked out
  | 'burning'   // your own trail was cut and is burning toward you
  | 'down'      // you were knocked out
  | 'revive'    // you came back
  | 'start'     // a round begins
  | 'win'
  | 'gameover'
  | 'newBest';

const MUTE_KEY = 'territory-wars.muted';
const MASTER_GAIN = 0.9;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let failed = false;
let muted = loadMuted();

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
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
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
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    failed = true;
    ctx = null;
    master = null;
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
  const t = c.currentTime + (o.delay ?? 0);
  const attack = o.attack ?? 0.006;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  // Short attack and exponential release so nothing clicks.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}

type NoiseOpts = { dur: number; gain: number; delay?: number; freq: number; q?: number; type?: BiquadFilterType };

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext, out: AudioNode, o: NoiseOpts): void {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(o.freq, t);
  f.Q.value = o.q ?? 1;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + o.dur + 0.02);
  src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
}

/** Notes as semitones above A4 (440 Hz). */
const note = (semi: number) => 440 * 2 ** (semi / 12);

// ---------- the sounds ----------

const SOUNDS: Record<SoundName, (c: AudioContext, out: AudioNode) => void> = {
  capture(c, out) {
    // Soft rising blip with a little sparkle on top.
    tone(c, out, { f0: 660, f1: 880, dur: 0.09, gain: 0.08 });
    tone(c, out, { f0: 1320, f1: 1760, dur: 0.07, gain: 0.025, delay: 0.03 });
  },
  cut(c, out) {
    // Quick "swish": a filtered noise sweep plus a bright ping.
    noise(c, out, { dur: 0.12, gain: 0.12, freq: 2400, q: 2.5 });
    tone(c, out, { type: 'triangle', f0: 1200, f1: 1600, dur: 0.1, gain: 0.05, delay: 0.02 });
  },
  kill(c, out) {
    // Punchy knockout: low thump, crunch, then a short victory chirp.
    tone(c, out, { f0: 180, f1: 55, dur: 0.22, gain: 0.22 });
    noise(c, out, { dur: 0.16, gain: 0.14, freq: 900, q: 0.8 });
    tone(c, out, { type: 'square', f0: note(3), dur: 0.07, gain: 0.035, delay: 0.1 });
    tone(c, out, { type: 'square', f0: note(10), dur: 0.11, gain: 0.035, delay: 0.17 });
  },
  burning(c, out) {
    // Warning: two quick falling beeps with crackle — get home!
    tone(c, out, { type: 'triangle', f0: 990, f1: 700, dur: 0.1, gain: 0.07 });
    tone(c, out, { type: 'triangle', f0: 990, f1: 700, dur: 0.1, gain: 0.07, delay: 0.14 });
    noise(c, out, { dur: 0.3, gain: 0.05, freq: 3200, q: 0.7, type: 'highpass' });
  },
  down(c, out) {
    // Sad descending "wah-wah".
    tone(c, out, { type: 'triangle', f0: note(-2), f1: note(-4), dur: 0.22, gain: 0.1 });
    tone(c, out, { type: 'triangle', f0: note(-5), f1: note(-7), dur: 0.22, gain: 0.1, delay: 0.22 });
    tone(c, out, { type: 'triangle', f0: note(-9), f1: note(-14), dur: 0.5, gain: 0.1, delay: 0.44 });
  },
  revive(c, out) {
    // Upward sparkle arpeggio.
    [0, 4, 7, 12, 16].forEach((s, i) =>
      tone(c, out, { f0: note(s + 3), dur: 0.16, gain: 0.06, delay: i * 0.055 }));
    noise(c, out, { dur: 0.35, gain: 0.03, freq: 6000, q: 0.5, type: 'highpass', delay: 0.05 });
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
};

/** Difficulty pick: a soft click whose pitch rises Easy → Normal → Hard. */
const SELECT_SEMI: Record<Difficulty, number> = { easy: -5, normal: 2, hard: 9 };

function play(fn: (c: AudioContext, out: AudioNode) => void): void {
  if (muted || !ctx || !master || ctx.state !== 'running') return;
  try { fn(ctx, master); } catch { /* ignore */ }
}

export function playSound(name: SoundName): void {
  play(SOUNDS[name]);
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
