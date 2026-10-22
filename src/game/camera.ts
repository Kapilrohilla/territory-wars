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
};

const FOLLOW_RATE = 8;
/** Settles a zoom change in about half a second. */
const ZOOM_RATE = 5;
const NUDGE_DECAY = 7;
const NUDGE_ZOOM = 0.08;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createCamera(): Camera {
  let first = true;
  let baseHalf: number = CONFIG.ZOOM_MIN;
  let pulse = 0;

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
      cam.halfHeight = baseHalf * (1 - NUDGE_ZOOM * Math.min(pulse, 1));
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
  };
  return cam;
}
