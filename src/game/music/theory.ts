/**
 * Music theory for the adaptive soundtrack (pure; no Web Audio, no DOM). Pitches are
 * semitones relative to A4 in C major; the player adds the round's key afterwards.
 */
import type { Difficulty } from '../../sim/config';
import { mulberry32 } from '../../sim/rng';

export type Rng = () => number;

/** A seeded mulberry32 stream in [0, 1); the music never touches Math.random. */
export function createRng(seed: number): Rng {
  return mulberry32(seed);
}

export const BPM: Record<Difficulty, number> = { easy: 108, normal: 112, hard: 120 };
export const STEPS_PER_BAR = 16;
export const BARS_PER_PHRASE = 4;
/** Semitone offsets from C a round may be played in (A, B♭, B, C or D♭ major). */
export const ROUND_KEYS = [-3, -2, -1, 0, 1];

/** Seconds per 16th note at `bpm`. */
export const stepSeconds = (bpm: number) => 60 / bpm / 4;

/** Bright major-key progressions as 1-based scale degrees, one chord per bar. */
export const PROGRESSIONS: number[][] = [
  [1, 5, 6, 4],
  [1, 6, 4, 5],
  [4, 1, 5, 6],
  [1, 4, 6, 5],
  [6, 4, 1, 5],
  [1, 3, 4, 5],
  [4, 5, 3, 6],
  [1, 4, 2, 5],
];

/** Minor-leaning progressions for danger: still in the major key, centred on vi. */
export const TENSE_PROGRESSIONS: number[][] = [
  [6, 4, 6, 5],
  [6, 5, 4, 5],
  [6, 3, 4, 5],
  [6, 2, 6, 5],
];

/** C major from C4 to B4, in semitones vs A4. */
const SCALE = [-9, -7, -5, -4, -2, 0, 2];

/** Scale step `i` (0 = C4, 7 = C5, -1 = B3 …) in semitones vs A4. */
export function scaleSemi(i: number): number {
  const oct = Math.floor(i / 7);
  return SCALE[i - oct * 7] + 12 * oct;
}

/** Root-position triad on 1-based `degree`, in semitones vs A4 (C4 … B4 roots). */
export function chordSemis(degree: number): number[] {
  const r = degree - 1;
  return [scaleSemi(r), scaleSemi(r + 2), scaleSemi(r + 4)];
}
