import type { MultiPoly, Vec } from '../sim/geometry';

/**
 * The capture wave: newly captured land fills outward from where the loop closed. One
 * source for its timing, shared by the effect (effects.ts) and the capture sweep sound
 * (sfxEvents.ts) so they always end together.
 */
export const WAVE_MIN_S = 0.35;
export const WAVE_MAX_S = 0.9;
const WAVE_PER_SQRT_AREA = 0.012;

/** Seconds the wave takes to cover a region of `area` square world units. */
export function waveSeconds(area: number): number {
  const s = WAVE_MIN_S + WAVE_PER_SQRT_AREA * Math.sqrt(Math.max(0, area));
  if (!(s > WAVE_MIN_S)) return WAVE_MIN_S;
  return s > WAVE_MAX_S ? WAVE_MAX_S : s;
}

/** Wave front radius t seconds in: 0 at the start, maxDist once the wave is done (easeOutCubic). */
export function waveRadius(t: number, waveS: number, maxDist: number): number {
  if (!(t > 0) || !(waveS > 0)) return t > 0 ? maxDist : 0;
  const u = t >= waveS ? 1 : t / waveS;
  return maxDist * (1 - (1 - u) ** 3);
}

/** Distance from `o` to the farthest vertex of the region (0 when empty). */
export function maxDistFrom(m: MultiPoly, o: Vec): number {
  let best = 0;
  for (const poly of m) {
    for (const ring of poly) {
      for (const p of ring) {
        const d = (p.x - o.x) ** 2 + (p.y - o.y) ** 2;
        if (d > best) best = d;
      }
    }
  }
  return Math.sqrt(best);
}
