/**
 * Head lean and squash while turning (render-side only, never touches the sim). The turn
 * rate comes from the rendered (interpolated) heading frame to frame, and the pose eases
 * toward its target with a critically damped lerp so it never jitters.
 */
import { angleDiff } from '../sim/geometry';

/** Lean (rad) per rad/s of turn rate, and its clamp. */
export const LEAN_PER_RATE = 0.06;
export const LEAN_MAX = 0.35;
/** Turn rate (rad/s) at which the squash is full. */
export const SQUASH_RATE = 6;
/** Full squash: sx = 1 + SQUASH·k, sy = 1 − SQUASH·k. */
export const SQUASH = 0.12;
/** Smoothing rate (1/s): factor 1 − exp(−SMOOTH_RATE·dt). */
export const SMOOTH_RATE = 12;
/** Motion swooshes show while the smoothed k is above this. */
export const SWOOSH_K = 0.6;

/** Frame dt guards: a shorter frame is treated as this long when dividing (no spikes)… */
const MIN_RATE_DT = 1 / 240;
/** …and a longer one (after a pause or a freeze) smooths as if it were this long. */
const MAX_SMOOTH_DT = 0.1;
/** A heading change this big in one frame is a respawn/revive jump, not a turn. */
const JUMP_RAD = 1;

export type LeanPose = { lean: number; k: number; sx: number; sy: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The target pose for a turn rate (rad/s, + = clockwise on screen). Writes to out if given. */
export function leanPose(turnRate: number, out: LeanPose = { lean: 0, k: 0, sx: 1, sy: 1 }): LeanPose {
  const r = Number.isNaN(turnRate) ? 0 : turnRate;
  const k = clamp(Math.abs(r) / SQUASH_RATE, 0, 1);
  out.lean = clamp(r * LEAN_PER_RATE, -LEAN_MAX, LEAN_MAX);
  out.k = k;
  out.sx = 1 + SQUASH * k;
  out.sy = 1 - SQUASH * k;
  return out;
}

/** Critically damped lerp factor for a frame of dt seconds. */
export function smoothFactor(dt: number): number {
  return dt > 0 ? 1 - Math.exp(-SMOOTH_RATE * dt) : 0;
}

/** One head's smoothed lean/squash; `heading` is the last rendered heading (NaN = unseen). */
export type LeanState = { heading: number; lean: number; k: number };

export function createLeanState(): LeanState {
  return { heading: NaN, lean: 0, k: 0 };
}

const target: LeanPose = { lean: 0, k: 0, sx: 1, sy: 1 };

/**
 * Advances a head's pose to this frame's rendered heading. dt is real frame time (s); a
 * zero/negative dt (a resize repaint) leaves the pose as it is.
 */
export function stepLean(s: LeanState, heading: number, dt: number): LeanState {
  if (!(dt > 0)) return s;
  if (Number.isNaN(s.heading)) {
    s.heading = heading;
    return s;
  }
  const d = angleDiff(heading, s.heading);
  s.heading = heading;
  const rate = Math.abs(d) > JUMP_RAD ? 0 : d / Math.max(dt, MIN_RATE_DT);
  leanPose(rate, target);
  const f = smoothFactor(Math.min(dt, MAX_SMOOTH_DT));
  s.lean += (target.lean - s.lean) * f;
  s.k += (target.k - s.k) * f;
  return s;
}
