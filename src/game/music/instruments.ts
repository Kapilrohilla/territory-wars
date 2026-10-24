/**
 * Synth voices for the adaptive music, one per composer Layer. Each voice writes one note into
 * `out` at context time `t`, peaks at no more than MAX_GAIN × vel, keeps its main energy where
 * phone speakers can play it (≥ 150 Hz, with upper harmonics on the bass and a click on the kick)
 * and disconnects every node it made once its sources end.
 */
import { MAX_GAIN } from '../sound';
import type { Layer } from './composer';

export type Voice = (c: AudioContext, out: AudioNode, t: number, freq: number, durS: number, vel: number) => void;

const SILENT = 0.0001;

const noiseBufs = new WeakMap<AudioContext, AudioBuffer>();
function noiseBuffer(c: AudioContext): AudioBuffer {
  let b = noiseBufs.get(c);
  if (!b) {
    b = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(c, b);
  }
  return b;
}

/** Builds one voice: tracks its nodes and sources so they all disconnect when the last source ends. */
function kit(c: AudioContext) {
  const nodes: AudioNode[] = [];
  const srcs: AudioScheduledSourceNode[] = [];
  const add = <T extends AudioNode>(n: T): T => { nodes.push(n); return n; };
  return {
    osc(type: OscillatorType, f: number, t: number): OscillatorNode {
      const o = add(c.createOscillator());
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      srcs.push(o);
      return o;
    },
    noise(): AudioBufferSourceNode {
      const s = add(c.createBufferSource());
      s.buffer = noiseBuffer(c);
      s.loop = true;
      srcs.push(s);
      return s;
    },
    /** A gain that modulates an AudioParam (its value is a depth, not an audio level). */
    mod(): GainNode {
      return add(c.createGain());
    },
    /** A fixed mix level (≤ 1). */
    gain(v: number): GainNode {
      const g = add(c.createGain());
      g.gain.value = v;
      return g;
    },
    filter(type: BiquadFilterType, f: number, t: number, q = 0.7): BiquadFilterNode {
      const n = add(c.createBiquadFilter());
      n.type = type;
      n.frequency.setValueAtTime(f, t);
      n.Q.value = q;
      return n;
    },
    /** An envelope: rises from silence to `peak`, holds `sustain`×peak until `holdTo`, then fades out by `end`. */
    env(peak: number, t: number, attack: number, sustain: number, holdTo: number, end: number): GainNode {
      const g = add(c.createGain());
      g.gain.setValueAtTime(SILENT, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      const hold = Math.max(t + attack, holdTo);
      if (sustain < 1) g.gain.exponentialRampToValueAtTime(Math.max(SILENT, peak * sustain), hold);
      else g.gain.setValueAtTime(peak, hold);
      g.gain.exponentialRampToValueAtTime(SILENT, Math.max(hold + 0.01, end));
      return g;
    },
    /** Starts every source at `t`, stops it at `end`, and frees the whole voice after the last one ends. */
    play(t: number, end: number): void {
      let left = srcs.length;
      for (const s of srcs) {
        s.onended = () => {
          if (--left > 0) return;
          for (const n of nodes) n.disconnect();
        };
        s.start(t);
        s.stop(end + 0.02);
      }
    },
  };
}

const peakOf = (vel: number, k: number) => MAX_GAIN * Math.min(1, Math.max(0, vel)) * k;

/** Marimba-ish pluck: a triangle with a soft octave, decaying fast. */
const pluck: Voice = (c, out, t, f, durS, vel) => {
  const k = kit(c);
  const end = t + Math.min(0.45, Math.max(0.16, durS * 1.4));
  const e = k.env(peakOf(vel, 0.85), t, 0.004, 0.25, t + 0.06, end);
  const a = k.gain(0.75), b = k.gain(0.25);
  k.osc('triangle', f, t).connect(a);
  k.osc('sine', f * 2, t).connect(b);
  a.connect(e); b.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Warm pad: two slightly detuned saws through a soft lowpass with a slow attack. */
const pad: Voice = (c, out, t, f, durS, vel) => {
  const k = kit(c);
  const end = t + durS + 0.35;
  const e = k.env(peakOf(vel, 0.6), t, Math.min(0.35, durS * 0.4), 0.8, t + durS, end);
  const lp = k.filter('lowpass', Math.min(2400, f * 3), t);
  for (const d of [1.004, 1 / 1.004]) {
    const m = k.gain(0.5);
    k.osc('sawtooth', f * d, t).connect(m);
    m.connect(lp);
  }
  lp.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Round bass: a triangle plus a stronger 2× sine so small speakers still carry the line. */
const bass: Voice = (c, out, t, f, durS, vel) => {
  const k = kit(c);
  const end = t + durS + 0.08;
  const e = k.env(peakOf(vel, 0.9), t, 0.005, 0.7, t + durS, end);
  const a = k.gain(0.4), b = k.gain(0.6);
  k.osc('triangle', f, t).connect(a);
  k.osc('sine', f * 2, t).connect(b);
  a.connect(e); b.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Lead: a lowpassed square with a gentle vibrato that fades in. */
const lead: Voice = (c, out, t, f, durS, vel) => {
  const k = kit(c);
  const end = t + durS + 0.1;
  const e = k.env(peakOf(vel, 0.55), t, 0.01, 0.75, t + durS, end);
  const lp = k.filter('lowpass', Math.min(4000, f * 4), t);
  const o = k.osc('square', f, t);
  const lfo = k.osc('sine', 5.5, t);
  // Modulation depth in Hz (feeds o.frequency, not the audio path): about ±10 cents.
  const vib = k.mod();
  vib.gain.setValueAtTime(0, t);
  vib.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.25, durS));
  lfo.connect(vib);
  vib.connect(o.frequency);
  o.connect(lp);
  lp.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Stab: three detuned saws, bright and short. */
const stab: Voice = (c, out, t, f, _durS, vel) => {
  const k = kit(c);
  const end = t + 0.16;
  const e = k.env(peakOf(vel, 0.5), t, 0.004, 0.3, t + 0.05, end);
  const lp = k.filter('lowpass', Math.min(5000, f * 6), t);
  for (const d of [1, 1.006, 1 / 1.006]) {
    const m = k.gain(1 / 3);
    k.osc('sawtooth', f * d, t).connect(m);
    m.connect(lp);
  }
  lp.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Kick: a 160 → 60 Hz sine thump plus a 2 kHz click so phone speakers still hear the beat. */
const kick: Voice = (c, out, t, _f, _durS, vel) => {
  const k = kit(c);
  const end = t + 0.22;
  const body = k.env(peakOf(vel, 0.9), t, 0.003, 1, t + 0.003, end);
  const o = k.osc('sine', 160, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
  o.connect(body);
  body.connect(out);
  const click = k.env(peakOf(vel, 0.35), t, 0.001, 1, t + 0.001, t + 0.025);
  k.osc('triangle', 2000, t).connect(click);
  click.connect(out);
  k.play(t, end);
};

/** Clap: a short burst of bandpassed noise. */
const clap: Voice = (c, out, t, _f, _durS, vel) => {
  const k = kit(c);
  const end = t + 0.14;
  const e = k.env(peakOf(vel, 0.7), t, 0.002, 0.35, t + 0.02, end);
  const bp = k.filter('bandpass', 1500, t, 1.2);
  k.noise().connect(bp);
  bp.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Hat: a tick of highpassed noise. */
const hat: Voice = (c, out, t, _f, _durS, vel) => {
  const k = kit(c);
  const end = t + 0.05;
  const e = k.env(peakOf(vel, 0.5), t, 0.001, 1, t + 0.001, end);
  const hp = k.filter('highpass', 7000, t);
  k.noise().connect(hp);
  hp.connect(e);
  e.connect(out);
  k.play(t, end);
};

/** Fill: one quick tom hit an octave under the stinger's pitch hint (≥ 150 Hz so phones play it),
 * so the composer's rising last hit per streak gives a higher tom. Pitch sags a little as it rings. */
const fill: Voice = (c, out, t, f, _durS, vel) => {
  const k = kit(c);
  const p = Math.max(150, f / 2);
  const end = t + 0.18;
  const e = k.env(peakOf(vel, 0.8), t, 0.002, 1, t + 0.002, end);
  const a = k.gain(0.7), b = k.gain(0.3);
  const body = k.osc('sine', p, t);
  body.frequency.exponentialRampToValueAtTime(p * 0.8, end);
  body.connect(a);
  const ring = k.osc('triangle', p * 1.5, t);
  ring.frequency.exponentialRampToValueAtTime(p * 1.2, end);
  ring.connect(b);
  a.connect(e); b.connect(e);
  e.connect(out);
  k.play(t, end);
};

export const VOICES: Record<Layer, Voice> = { pad, pluck, bass, kick, clap, hat, lead, stab, fill };
