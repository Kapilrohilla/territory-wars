/**
 * The adaptive music composer (pure and seeded; no Web Audio, no DOM). Each bar() returns
 * the notes for one bar from the current mood and excitement: a soft pad and plucks when
 * calm, bass and light drums outside, a tighter pulse in danger, bare drums while burning,
 * and a short hummable motif only while excitement is high. events() turns game cues into
 * beat-quantized stingers, excitement boosts, milestone key lifts, going down and the ending.
 * Pitches are semitones vs A4 in C major; the player adds the round key and keyOffset.
 */
import { DANGER_SHOW } from '../danger';
import {
  BARS_PER_PHRASE, PROGRESSIONS, STEPS_PER_BAR, TENSE_PROGRESSIONS, createRng, scaleSemi, type Rng,
} from './theory';

export type Layer = 'pad' | 'pluck' | 'bass' | 'kick' | 'clap' | 'hat' | 'lead' | 'stab' | 'fill';
/** step = absolute 16th since start; semi = semitones vs A4 in C (before transpose); dur in steps; vel 0..1. */
export type NoteEv = { layer: Layer; step: number; semi: number; dur: number; vel: number };
export type MusicEvent = 'steal' | 'capture' | 'kill' | 'escape' | 'overtake' | 'milestone' | 'down' | 'revive' | 'win' | 'gameover';
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
/** Excitement each event lifts to; a steal also holds the fullest arrangement for a few bars. */
export const BOOST = { steal: 1, capture: 0.6, kill: 0.6, escape: 0.35, overtake: 0.35 } as const;
type BoostEvent = keyof typeof BOOST;
const MAX_KEY_OFFSET = 3;
/** Notes this close (in steps) after an 8th boundary still land on it, so the hit feels instant. */
const QUANTIZE_SLACK = 0.25;

/** The next 8th-note boundary (an even step) at or after `nowStep`, or the one just passed if within the slack. */
export function quantize(nowStep: number): number {
  const b = 2 * Math.floor(nowStep / 2);
  return nowStep - b <= QUANTIZE_SLACK ? b : b + 2;
}

export type Composer = {
  /** Takes effect at the next bar(). */
  setMood(m: MusicMood): void;
  /** All notes for steps index·16 … index·16 + 15. */
  bar(index: number): NoteEv[];
  /** One call per sim step's cues; returns stinger notes at or after quantize(nowStep). */
  events(list: { e: MusicEvent; size?: number }[], nowStep: number): NoteEv[];
  readonly excitement: number;
  /** 0..3 milestones passed (from the bar after each), added on top of the round key. */
  readonly keyOffset: number;
  readonly state: 'playing' | 'down' | 'ended';
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
    // No kick in danger: the heartbeat there isn't tempo-locked and a kick would beat against it.
    s.add('lead').add('clap');
    if (tier < 2) s.add('kick');
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
/** Lead rhythms: [step, dur]; pitches are filled in per motif. */
const LEAD_RHYTHMS = [
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4]],
  [[0, 3], [3, 3], [6, 2], [8, 6]],
  [[0, 2], [3, 1], [4, 2], [8, 2], [10, 2], [12, 3]],
  [[2, 2], [4, 2], [6, 4], [12, 4]],
];
/** Pluck hits allowed to wander off the triad onto its upper neighbour (weak 16ths). */
const PASSING_P = 0.3;
const MAX_PLUCK = 6;
/** Melodic steps along a chord-tone ladder: plucks keep moving. */
const PLUCK_MOVES = [-2, -1, -1, 1, 1, 2];
/** Lead intervals in scale steps: mostly steps, sometimes a repeat, occasionally a leap. */
const LEAD_MOVES = [-1, -1, -1, -1, 1, 1, 1, 1, 0, 2, -2, 3];
/** Lowest scale step of the pluck (C5; C4 when drifted low) and pad (C4 or F4). */
const PLUCK_HI = 7, PLUCK_LO = 0;
/** The lead melody lives in scale steps C5 … E6 (semis 3 … 19). */
const LEAD_LO = 7, LEAD_HI = 16;
/** Steal riff chord tones span E4 … A5, so the big riff's octave-up ending stays ≤ A6 (semi 24). */
const RIFF_LO = 2, RIFF_HI = 12;
/** Steal riffs: [step, dur] rhythms and contours as ladder indices (-1 = top), ending on a stab. */
const RIFF_SMALL = { rhythm: [[0, 2], [2, 1], [3, 3], [6, 2], [8, 4]], stabAt: 12 };
const RIFF_BIG = { rhythm: [[0, 2], [2, 1], [3, 1], [4, 2], [6, 2], [8, 2], [10, 2]], stabAt: 12 };
const RIFF_SMALL_SHAPES = [[0, 2, 1, 3, -1], [1, 3, 2, 3, -1], [0, 1, 3, 2, -1], [2, 1, 3, 2, -1]];
const RIFF_BIG_SHAPES = [[0, 2, 1, 3, 2, 3, -1], [1, 0, 2, 1, 3, 2, -1], [0, 1, 2, 1, 3, 2, -1]];
/** Kill fill: one beat of hits; the last climbs one whole tone per extra streak. */
const FILL_SEMIS = [0, 0, 2, 4];
const MAX_STREAK_LIFT = 4;
const PAD_BASES = [0, 3];

/** Per-phrase drift: skip at most one non-essential calm detail. */
type Drift = 'none' | 'padThin' | 'pluckLow';
const DRIFTS: Drift[] = ['none', 'none', 'padThin', 'pluckLow'];

/** A lead motif: a rhythm plus the scale-step move into each note, re-fitted to each bar's chord. */
type Motif = { notes: { at: number; dur: number; move: number }[]; anchor: number; bars: number };

const vel = (v: number) => Math.min(1, Math.max(0.01, v));

/** Triad on 0-based scale root `r`, folded into the octave of scale steps [base, base + 6], low to high. */
function folded(r: number, base: number): number[] {
  return [r, r + 2, r + 4].map((t) => base + ((((t - base) % 7) + 7) % 7)).sort((a, b) => a - b);
}

/** Whether scale step `t` is a tone of the triad on 0-based root `r`. */
function isChordTone(t: number, r: number): boolean {
  const d = (((t - r) % 7) + 7) % 7;
  return d === 0 || d === 2 || d === 4;
}

/** Chord tones of root `r` within scale steps [lo, hi], low to high. */
function chordLadder(r: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let t = lo; t <= hi; t++) if (isChordTone(t, r)) out.push(t);
  return out;
}

/** The chord tone of root `r` nearest `t` within [lo, hi], preferring the `dir` side (+1 when 0) on ties. */
function snap(t: number, r: number, lo: number, hi: number, dir: number): number {
  const d = dir < 0 ? -1 : 1;
  for (const o of [0, d, -d, 2 * d, -2 * d, 3 * d, -3 * d]) {
    const c = t + o;
    if (c >= lo && c <= hi && isChordTone(c, r)) return c;
  }
  return t;
}

export function createComposer(opts: { seed: number }): Composer {
  const rng: Rng = createRng(opts.seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  /** A melodic step from index `i` within [0, len): moves by one of `moves`, bouncing off the ends. */
  const walk = (i: number, len: number, moves: readonly number[]) => {
    const m = pick(moves);
    const n = i + m >= 0 && i + m < len ? i + m : i - m;
    return Math.min(len - 1, Math.max(0, n));
  };

  let pending: MusicMood = { tier: 0, danger: 0 };
  let excitement = 0;
  /** Bars still held at FULL_AT or above by a steal. */
  let hold = 0;
  let keyOffset = 0, pendingKey = 0;
  let state: 'playing' | 'down' | 'ended' = 'playing';
  /** The bar lead stays quiet before this step so a steal riff is heard on its own. */
  let riffEnd = -Infinity;
  /** Root (0-based scale step) of the chord in the last bar, for stingers. */
  let chordRoot = 0;
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
    const notes = pick(LEAD_RHYTHMS).map(([at, dur], i) => ({ at, dur, move: i === 0 ? 0 : pick(LEAD_MOVES) }));
    return { notes, anchor: 9 + Math.floor(rng() * 3), bars: 0 };
  }

  /** Steal: a bouncy lead riff over one bar ending on a stab; bigger steals run longer and leap an octave. */
  function stealRiff(q: number, size: number): NoteEv[] {
    const big = size >= 2;
    const { rhythm, stabAt } = big ? RIFF_BIG : RIFF_SMALL;
    const shape = pick(big ? RIFF_BIG_SHAPES : RIFF_SMALL_SHAPES);
    const ladder = chordLadder(chordRoot, RIFF_LO, RIFF_HI);
    const out: NoteEv[] = rhythm.map(([at, dur], i) => {
      const idx = shape[i] < 0 ? ladder.length - 1 : Math.min(shape[i], ladder.length - 2);
      const last = i === rhythm.length - 1;
      return { layer: 'lead', step: q + at, semi: scaleSemi(ladder[idx]) + (last && big ? 12 : 0), dur, vel: at % 4 === 0 ? 0.75 : 0.62 };
    });
    for (const t of folded(chordRoot, 3)) out.push({ layer: 'stab', step: q + stabAt, semi: scaleSemi(t), dur: 2, vel: 0.55 });
    riffEnd = q + STEPS_PER_BAR;
    return out;
  }

  /** The stinger for one boost event at quantized step `q`. */
  function stinger(e: BoostEvent, q: number, size: number): NoteEv[] {
    const tri = folded(chordRoot, PLUCK_HI);
    const pluck = (i: number, t: number): NoteEv => ({ layer: 'pluck', step: q + 2 * i, semi: scaleSemi(t), dur: 2, vel: 0.5 + 0.05 * i });
    switch (e) {
      case 'steal': return stealRiff(q, size);
      case 'capture': return tri.map((t, i) => pluck(i, t));
      case 'kill': {
        const lift = 2 * Math.min(MAX_STREAK_LIFT, Math.max(0, Math.floor(size) - 1));
        return FILL_SEMIS.map((semi, i) => ({
          layer: 'fill', step: q + i, semi: i === FILL_SEMIS.length - 1 ? semi + lift : semi, dur: 1, vel: 0.5 + 0.1 * i,
        }));
      }
      case 'escape':
      case 'overtake': return [pluck(0, tri[0]), pluck(1, tri[2])];
    }
  }

  /** A 2-bar I–V–I close on pad, with a rising lead line home on a win. */
  function cadence(q: number, win: boolean): NoteEv[] {
    const out: NoteEv[] = [];
    for (const [at, dur, r] of [[0, 8, 0], [8, 8, 4], [16, 16, 0]]) {
      for (const t of folded(r, 0)) out.push({ layer: 'pad', step: q + at, semi: scaleSemi(t), dur, vel: 0.4 });
    }
    if (win) {
      // E5 G5 | G5 B5 | C6: chord tones climbing to the tonic.
      for (const [at, dur, t] of [[0, 4, 9], [4, 4, 11], [8, 4, 11], [12, 4, 13], [16, 16, 14]]) {
        out.push({ layer: 'lead', step: q + at, semi: scaleSemi(t), dur, vel: at === 16 ? 0.7 : 0.6 });
      }
    }
    return out;
  }

  return {
    setMood(m) { pending = { ...m }; },
    get excitement() { return excitement; },
    get keyOffset() { return keyOffset; },
    get state() { return state; },

    events(list, nowStep) {
      if (state === 'ended') return [];
      if (state === 'down') {
        if (list.some((x) => x.e === 'revive')) { state = 'playing'; excitement = 0; hold = 0; }
        else if (list.some((x) => x.e === 'win' || x.e === 'gameover')) state = 'ended';
        return [];
      }
      const q = quantize(nowStep);
      for (const x of list) if (x.e === 'milestone') pendingKey = Math.min(MAX_KEY_OFFSET, pendingKey + 1);
      const end = list.find((x) => x.e === 'win' || x.e === 'gameover');
      if (end) {
        state = 'ended';
        return cadence(q, end.e === 'win');
      }
      if (list.some((x) => x.e === 'down')) { state = 'down'; return []; }
      if (list.some((x) => x.e === 'revive')) { excitement = 0; hold = 0; }
      let best: { e: BoostEvent; size: number } | null = null;
      for (const x of list) {
        if (!(x.e in BOOST)) continue;
        const e = x.e as BoostEvent;
        if (!best || BOOST[e] > BOOST[best.e]) best = { e, size: x.size ?? 0 };
      }
      if (!best) return [];
      excitement = Math.max(excitement, BOOST[best.e]);
      if (best.e === 'steal') hold = Math.max(hold, 2 + Math.min(4, Math.floor(best.size)));
      return stinger(best.e, q, best.size);
    },

    bar(index) {
      keyOffset = pendingKey;
      if (state !== 'playing') return [];
      const { tier } = pending;
      const wantTense = tier === 2;
      if (!prog || index % BARS_PER_PHRASE === 0 || wantTense !== tense) newPhrase(wantTense);
      const r = prog![index % BARS_PER_PHRASE] - 1;
      chordRoot = r;
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
          const dur = passing ? 1 + Math.floor(rng() * 2) : 3;
          add('pluck', s, scaleSemi(ladder[pluckIdx] + (passing ? 1 : 0)), dur, (s % 4 === 0 ? 0.45 : 0.32) + rng() * 0.08);
        }
      }

      if (layers.has('bass')) {
        const root = scaleSemi(r) - 12;
        // Keep the bass under the pad (lowest pad note C4 = -9).
        const fifth = scaleSemi(r + 4) - 12 - (scaleSemi(r + 4) - 12 > -9 ? 12 : 0);
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
        const tri = folded(r, LEAD_LO);
        const shift = motif.bars === 0 ? 0 : pick([0, 0, 2, 4]);
        const invert = motif.bars % 2 === 1;
        // Rotating the rhythm keeps each note's move; strong beats snap to chord tones, the rest
        // walk the scale, so passing tones fall between chord tones.
        const line = motif.notes
          .map((n) => ({ at: (n.at + shift) % STEPS_PER_BAR, dur: n.dur, move: invert ? -n.move : n.move }))
          .sort((a, b) => a.at - b.at);
        let tone = snap(motif.anchor, r, LEAD_LO, LEAD_HI, 1);
        const lead: NoteEv[] = [];
        line.forEach((n, i) => {
          if (i > 0) {
            let t = tone + n.move;
            if (t < LEAD_LO || t > LEAD_HI) t = tone - n.move;
            t = Math.min(LEAD_HI, Math.max(LEAD_LO, t));
            if (n.at % 4 === 0) {
              // Snap back toward the last note, unless that would stall a moving line.
              const back = snap(t, r, LEAD_LO, LEAD_HI, tone - t);
              tone = back === tone && n.move !== 0 ? snap(t, r, LEAD_LO, LEAD_HI, n.move) : back;
            } else tone = t;
          } else tone = snap(tone, r, LEAD_LO, LEAD_HI, 1);
          const next = i + 1 < line.length ? line[i + 1].at : STEPS_PER_BAR;
          lead.push({ layer: 'lead', step: at + n.at, semi: scaleSemi(tone), dur: Math.min(n.dur, next - n.at), vel: vel(i === 0 ? 0.7 : 0.6) });
        });
        if (full) {
          // Counter line: low chord tones on the beats the motif leaves free.
          for (const s of [0, 4, 8, 12]) {
            if (!line.some((n) => n.at === s)) lead.push({ layer: 'lead', step: at + s, semi: scaleSemi(pick(tri)) - 12, dur: 3, vel: 0.35 });
          }
        }
        // A steal riff still sounding owns the lead until it ends.
        for (const n of lead) if (n.step >= riffEnd) notes.push(n);
        motif.bars++;
      } else motif = null;

      if (layers.has('stab')) {
        const hits = rng() < 0.5 ? [6, 14] : [3, 6, 14];
        for (const s of hits) for (const t of folded(r, 3)) add('stab', s, scaleSemi(t), 1, 0.45);
      }

      if (hold > 0) hold--;
      if (hold === 0) excitement = Math.max(0, excitement - DECAY_PER_BAR);
      return notes.sort((a, b) => a.step - b.step);
    },
  };
}
