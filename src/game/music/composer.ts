/**
 * The adaptive music composer (pure and seeded; no Web Audio, no DOM). Each bar() returns
 * the notes for one bar from the current mood and excitement: a soft pad and plucks when
 * calm, bass and light drums outside, a tighter pulse in danger, bare drums while burning,
 * and a short hummable motif only while excitement is high. Pitches are semitones vs A4 in
 * C major; the player adds the round key and milestone offsets.
 */
import { DANGER_SHOW } from '../danger';
import {
  BARS_PER_PHRASE, PROGRESSIONS, STEPS_PER_BAR, TENSE_PROGRESSIONS, createRng, scaleSemi, type Rng,
} from './theory';

export type Layer = 'pad' | 'pluck' | 'bass' | 'kick' | 'clap' | 'hat' | 'lead' | 'stab' | 'fill';
/** step = absolute 16th since start; semi = semitones vs A4 in C (before transpose); dur in steps; vel 0..1. */
export type NoteEv = { layer: Layer; step: number; semi: number; dur: number; vel: number };
/** 0 home, 1 out, 2 danger, 3 burning. */
export type Tier = 0 | 1 | 2 | 3;
/** danger = raw DangerState level in [0, 1]. */
export type MusicMood = { tier: Tier; danger: number };

/** Excitement at which the lead melody (and a beat) comes in. */
export const MELODY_AT = 0.5;
/** Excitement for the fullest arrangement: stabs, a fuller pluck and a counter line. */
export const FULL_AT = 0.9;
/** Excitement lost per bar. */
export const DECAY_PER_BAR = 0.25;

export type Composer = {
  /** Takes effect at the next bar(). */
  setMood(m: MusicMood): void;
  /** All notes for steps index·16 … index·16 + 15. */
  bar(index: number): NoteEv[];
  readonly excitement: number;
};

export function tierFor(outside: boolean, dangerRaw: number, burning: boolean): Tier {
  if (burning) return 3;
  if (!outside) return 0;
  return dangerRaw >= DANGER_SHOW ? 2 : 1;
}

const TIER_LAYERS: Record<Tier, Layer[]> = {
  0: ['pad', 'pluck'],
  1: ['pad', 'pluck', 'bass', 'hat'],
  2: ['pad', 'pluck', 'bass', 'hat', 'clap'],
  3: ['kick', 'hat', 'bass'],
};

export function layersFor(tier: Tier, excitement: number): Set<Layer> {
  const s = new Set<Layer>(TIER_LAYERS[tier]);
  if (excitement >= MELODY_AT && tier < 3) {
    s.add('lead').add('kick').add('clap');
    if (excitement >= FULL_AT) s.add('stab');
  }
  return s;
}

/** Pluck rhythms (16th steps), sparse so calm stays background. */
const PLUCK_TEMPLATES = [[0, 6, 10], [0, 3, 8, 14], [2, 8, 11], [0, 4, 10, 12], [0, 7, 10, 14], [3, 6, 12]];
const HAT_TEMPLATES = [[2, 6, 10, 14], [0, 2, 4, 6, 8, 10, 12, 14], [2, 6, 10, 14, 15], [0, 4, 6, 8, 12, 14], [2, 5, 10, 13]];
/** Bass figures for "out": [step, dur, 0 root | 1 fifth]. */
const BASS_TEMPLATES = [
  [[0, 6, 0], [8, 4, 0], [12, 3, 1]],
  [[0, 3, 0], [3, 3, 0], [8, 4, 0], [14, 2, 1]],
  [[0, 5, 0], [6, 2, 1], [8, 6, 0]],
];
/** Lead rhythms: [step, dur]; tones are filled in per motif. */
const LEAD_RHYTHMS = [
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]],
  [[0, 3], [3, 3], [6, 2], [8, 6]],
  [[0, 2], [3, 1], [4, 2], [8, 2], [10, 2], [12, 3]],
  [[2, 2], [4, 2], [6, 4], [12, 4]],
];
/** Pluck hits allowed to wander off the triad onto its upper neighbour (weak 16ths). */
const PASSING_P = 0.3;
const MAX_PLUCK = 6;
/** Melodic steps along a chord-tone ladder: plucks keep moving, the lead may repeat a note. */
const PLUCK_MOVES = [-2, -1, -1, 1, 1, 2];
const LEAD_MOVES = [-2, -1, 0, 1, 2];
/** Lowest scale step of the pluck (C5; C4 when drifted low), pad (C4 or F4) and lead (C5). */
const PLUCK_HI = 7, PLUCK_LO = 0, LEAD_BASE = 7;
const PAD_BASES = [0, 3];

/** Per-phrase drift: skip at most one non-essential calm detail. */
type Drift = 'none' | 'padThin' | 'pluckLow';
const DRIFTS: Drift[] = ['none', 'none', 'padThin', 'pluckLow'];

type Motif = { notes: { at: number; dur: number; tone: number }[]; bars: number };

const vel = (v: number) => Math.min(1, Math.max(0.01, v));

/** Triad on 0-based scale root `r`, folded into the octave of scale steps [base, base + 6], low to high. */
function folded(r: number, base: number): number[] {
  return [r, r + 2, r + 4].map((t) => base + ((((t - base) % 7) + 7) % 7)).sort((a, b) => a - b);
}

/**
 * The composer. `excitement` seeds the starting excitement and exists only as a test seam
 * until event boosts arrive; the game always starts at 0.
 */
export function createComposer(opts: { seed: number; excitement?: number }): Composer {
  const rng: Rng = createRng(opts.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  /** A melodic step from index `i` within [0, len): moves by one of `moves`, bouncing off the ends. */
  const walk = (i: number, len: number, moves: readonly number[]) => {
    const m = pick(moves);
    const n = i + m >= 0 && i + m < len ? i + m : i - m;
    return Math.min(len - 1, Math.max(0, n));
  };

  let pending: MusicMood = { tier: 0, danger: 0 };
  let excitement = opts.excitement ?? 0;
  let prog: number[] | null = null;
  let tense = false;
  let pluckT: number[] = [];
  let hatT: number[] = [];
  let bassT: number[][] = [];
  let padBase = 0;
  let drift: Drift = 'none';
  let motif: Motif | null = null;
  let pluckIdx = 1;

  function newPhrase(wantTense: boolean): void {
    const pool = wantTense ? TENSE_PROGRESSIONS : PROGRESSIONS;
    const last = prog;
    prog = pick(pool.filter((p) => p !== last));
    tense = wantTense;
    pluckT = pick(PLUCK_TEMPLATES);
    hatT = pick(HAT_TEMPLATES);
    bassT = pick(BASS_TEMPLATES);
    padBase = pick(PAD_BASES);
    drift = pick(DRIFTS);
  }

  /** A per-bar copy of `t` with one hit dropped or one added (up to `max`). */
  function mutate(t: number[], max: number): number[] {
    const out = t.slice();
    if (out.length > 2 && (rng() < 0.5 || out.length >= max)) out.splice(Math.floor(rng() * out.length), 1);
    else {
      const free = [...Array(STEPS_PER_BAR).keys()].filter((s) => !out.includes(s));
      out.push(pick(free));
    }
    return out.sort((a, b) => a - b);
  }

  function newMotif(): Motif {
    let tone = 2 + Math.floor(rng() * 2);
    const notes = pick(LEAD_RHYTHMS).map(([at, dur]) => {
      const n = { at, dur, tone };
      tone = walk(tone, 6, LEAD_MOVES);
      return n;
    });
    return { notes, bars: 0 };
  }

  return {
    setMood(m) { pending = { ...m }; },
    get excitement() { return excitement; },

    bar(index) {
      const { tier } = pending;
      const wantTense = tier === 2;
      if (!prog || index % BARS_PER_PHRASE === 0 || wantTense !== tense) newPhrase(wantTense);
      const r = prog![index % BARS_PER_PHRASE] - 1;
      const layers = layersFor(tier, excitement);
      const full = excitement >= FULL_AT;
      const at = index * STEPS_PER_BAR;
      const notes: NoteEv[] = [];
      const add = (layer: Layer, step: number, semi: number, dur: number, v: number) =>
        notes.push({ layer, step: at + step, semi, dur: Math.max(1, Math.min(dur, STEPS_PER_BAR - step)), vel: vel(v) });

      if (layers.has('pad')) {
        let tones = folded(r, padBase);
        if (drift === 'padThin') tones = tones.filter((t) => (((t - r) % 7) + 7) % 7 !== 4); // drop the fifth
        for (const t of tones) add('pad', 0, scaleSemi(t), STEPS_PER_BAR, 0.3);
      }

      if (layers.has('pluck')) {
        let hits = mutate(pluckT, MAX_PLUCK);
        if (tier === 2) hits = hits.filter((_, i) => i % 2 === 0);
        if (full) hits = [...new Set([...hits, 2, 6, 10, 14])].sort((a, b) => a - b);
        const tri = folded(r, drift === 'pluckLow' ? PLUCK_LO : PLUCK_HI);
        const ladder = [...tri, tri[0] + 7];
        for (const s of hits) {
          pluckIdx = walk(pluckIdx, ladder.length, PLUCK_MOVES);
          const passing = s % 2 === 1 && pluckIdx < ladder.length - 1 && rng() < PASSING_P;
          add('pluck', s, scaleSemi(ladder[pluckIdx] + (passing ? 1 : 0)), 3, (s % 4 === 0 ? 0.45 : 0.32) + rng() * 0.08);
        }
      }

      if (layers.has('bass')) {
        const root = scaleSemi(r) - 12, fifth = scaleSemi(r + 4) - 12;
        if (tier === 3) for (const s of [0, 4, 8, 12]) add('bass', s, root, 2, 0.6);
        else if (tier === 2) for (let s = 0; s < STEPS_PER_BAR; s += 2) add('bass', s, root, 1, s % 4 === 0 ? 0.55 : 0.4);
        else for (const [s, d, f] of bassT) add('bass', s, f ? fifth : root, d, s === 0 ? 0.55 : 0.45);
      }

      if (layers.has('kick')) {
        const ks = tier === 3 ? [0, 4, 8, 12] : rng() < 0.5 ? [0, 8] : [0, 8, 11];
        for (const s of ks) add('kick', s, 0, 1, s % 8 === 0 ? 0.8 : 0.6);
      }
      if (layers.has('clap')) for (const s of [4, 12]) add('clap', s, 0, 1, 0.55);
      if (layers.has('hat')) {
        let hits = mutate(hatT, 10);
        if (tier === 3) hits = [...new Set([...hits, 0, 2, 4, 6, 8, 10, 12, 14])].sort((a, b) => a - b);
        for (const s of hits) add('hat', s, 0, 1, (s % 4 === 2 ? 0.3 : 0.2) + rng() * 0.08);
      }

      if (layers.has('lead')) {
        if (!motif) motif = newMotif();
        const tri = folded(r, LEAD_BASE);
        const ladder = [...tri, ...tri.map((t) => t + 7)];
        const shift = motif.bars === 0 ? 0 : pick([0, 0, 2, 4]);
        const invert = motif.bars % 2 === 1;
        const line = motif.notes
          .map((n) => ({ at: (n.at + shift) % STEPS_PER_BAR, dur: n.dur, tone: invert ? 5 - n.tone : n.tone }))
          .sort((a, b) => a.at - b.at);
        line.forEach((n, i) => {
          const next = i + 1 < line.length ? line[i + 1].at : STEPS_PER_BAR;
          add('lead', n.at, scaleSemi(ladder[n.tone]), Math.min(n.dur, next - n.at), i === 0 ? 0.7 : 0.6);
        });
        if (full) {
          // Counter line: low chord tones on the beats the motif leaves free.
          for (const s of [0, 4, 8, 12]) {
            if (!line.some((n) => n.at === s)) add('lead', s, scaleSemi(pick(tri)) - 12, 3, 0.35);
          }
        }
        motif.bars++;
      } else motif = null;

      if (layers.has('stab')) {
        const hits = rng() < 0.5 ? [6, 14] : [3, 6, 14];
        for (const s of hits) for (const t of folded(r, 3)) add('stab', s, scaleSemi(t), 1, 0.45);
      }

      excitement = Math.max(0, excitement - DECAY_PER_BAR);
      return notes.sort((a, b) => a.step - b.step);
    },
  };
}
