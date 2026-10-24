/**
 * Knockout "impact" timing: the hit-stop (freeze-frame) on a human kill and the slow-mo on
 * the human's own down. Pure scheduling; the session drives it with real-time ms stamps.
 */

/** How long the sim freezes when the human knocks someone out. */
export const HITSTOP_MS = 70;
/** Effects (and floating texts) keep moving at this share of real time during a hit-stop. */
export const HITSTOP_SCALE = 0.25;
/** Effects/camera time scale through the human's down, before the revive offer appears. */
export const DOWN_SLOW_SCALE = 0.35;
/** The down slow-mo eases in over this long. */
const DOWN_EASE_MS = 150;
/** Delay between the human's knock-out and the revive offer (session's onDown), so the hit is seen first. */
export const DOWN_DELAY_MS = 600;

/** localStorage flag for the "Screen shake & freeze-frames" setting; anything but '0' is on. */
export const IMPACT_KEY = 'territory-wars.impact';

type FlagStore = { getItem(key: string): string | null };

/**
 * The "screen shake & freeze-frames" setting (Task 7 adds its toggle). On when storage is
 * unavailable; storage is looked up inside the try, since touching blocked localStorage throws.
 */
export function impactEnabled(store?: FlagStore): boolean {
  try {
    return (store ?? globalThis.localStorage)?.getItem(IMPACT_KEY) !== '0';
  } catch {
    return true;
  }
}

export type HitStop = {
  /** Freezes until nowMs + ms; a trigger during a freeze extends it (never shortens it). */
  trigger(nowMs: number, ms?: number): void;
  /** False while frozen. */
  shouldStep(nowMs: number): boolean;
  /** Ends any freeze now. */
  clear(): void;
};

export function createHitStop(): HitStop {
  let until = -Infinity;
  return {
    trigger(nowMs, ms = HITSTOP_MS) {
      until = Math.max(until, nowMs + ms);
    },
    shouldStep(nowMs) {
      return nowMs >= until;
    },
    clear() {
      until = -Infinity;
    },
  };
}

/**
 * Effects/camera time scale `msSinceDown` ms after the human went down (null: not down):
 * eases from 1 to DOWN_SLOW_SCALE, holds until the revive offer, then back to full speed.
 */
export function downTimeScale(msSinceDown: number | null): number {
  if (msSinceDown === null || msSinceDown < 0 || msSinceDown >= DOWN_DELAY_MS) return 1;
  const u = Math.min(1, msSinceDown / DOWN_EASE_MS);
  const e = 1 - (1 - u) * (1 - u) * (1 - u); // ease-out cubic
  return 1 + (DOWN_SLOW_SCALE - 1) * e;
}
