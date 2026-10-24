import { CONFIG } from '../sim/config';
import type { Vec } from '../sim/geometry';

export type Camera = {
  /** World point at the screen centre. */
  x: number;
  y: number;
  /** Effective view half-height in world units (includes nudge). */
  halfHeight: number;
  /** Viewport size in CSS pixels. */
  viewW: number;
  viewH: number;
  resize(w: number, h: number): void;
  update(target: Vec, pct: number, dt: number): void;
  /** Pixels per world unit. */
  scale(): number;
  worldToScreen(p: Vec): Vec;
  nudge(strength: number): void;
  /** A quick zoom-in by `strength` (0.12 = 12%) that springs back over PUNCH_MS. */
  punch(strength: number): void;
};

const FOLLOW_RATE = 8;
/** Settles a zoom change in about half a second. */
const ZOOM_RATE = 5;
const NUDGE_DECAY = 7;
const NUDGE_ZOOM = 0.08;

/** A punch springs back to the base zoom over this long. */
export const PUNCH_MS = 250;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Zoom-punch strength share over its life u (0..1): 1 at the hit, a damped spring that dips
 * just past rest (a small overshoot) and is exactly 0 from u = 1 on.
 */
export function punchEnvelope(u: number): number {
  if (u < 0 || u >= 1) return 0;
  const k = 1 - u;
  return k * k * Math.cos(1.5 * Math.PI * u);
}

export function createCamera(): Camera {
  let first = true;
  let baseHalf: number = CONFIG.ZOOM_MIN;
  let pulse = 0;
  let punchAmp = 0;
  let punchT = 0;

  const cam: Camera = {
    x: 0,
    y: 0,
    halfHeight: CONFIG.ZOOM_MIN,
    viewW: 1,
    viewH: 1,
    resize(w, h) {
      cam.viewW = Math.max(1, w);
      cam.viewH = Math.max(1, h);
    },
    update(target, pct, dt) {
      const goal = CONFIG.ZOOM_MIN + (CONFIG.ZOOM_MAX - CONFIG.ZOOM_MIN) * clamp01(pct / CONFIG.ZOOM_FULL_PCT);
      if (first) {
        first = false;
        cam.x = target.x;
        cam.y = target.y;
        baseHalf = goal;
      } else {
        const k = 1 - Math.exp(-FOLLOW_RATE * dt);
        cam.x += (target.x - cam.x) * k;
        cam.y += (target.y - cam.y) * k;
        baseHalf += (goal - baseHalf) * (1 - Math.exp(-ZOOM_RATE * dt));
      }
      pulse *= Math.exp(-NUDGE_DECAY * dt);
      if (pulse < 1e-4) pulse = 0;
      let punchK = 0;
      if (punchAmp > 0) {
        punchK = punchAmp * punchEnvelope(punchT / (PUNCH_MS / 1000));
        punchT += dt;
        if (punchT >= PUNCH_MS / 1000) punchAmp = 0;
      }
      cam.halfHeight = baseHalf * (1 - NUDGE_ZOOM * Math.min(pulse, 1)) * (1 - punchK);
    },
    scale() {
      return cam.viewH / (2 * cam.halfHeight);
    },
    worldToScreen(p) {
      const s = cam.scale();
      return { x: (p.x - cam.x) * s + cam.viewW / 2, y: (p.y - cam.y) * s + cam.viewH / 2 };
    },
    nudge(strength) {
      pulse = Math.min(1, pulse + Math.max(0, strength));
    },
    punch(strength) {
      punchAmp = Math.min(0.5, Math.max(0, strength));
      punchT = 0;
    },
  };
  return cam;
}
