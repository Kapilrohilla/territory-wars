/**
 * How much trouble the human is in, from World alone (pure; no DOM, no canvas). The shell
 * turns these numbers into the danger vignette, the HUD pill, the heartbeat and the
 * burning-trail home arrow.
 */
import type { MultiPoly, Vec } from '../sim/geometry';
import { distPointSeg } from '../sim/geometry';
import { landContains } from '../sim/territory';
import type { Burn, World } from '../sim/types';
import { trailLength } from '../sim/world';

/** Danger at or above this shows the "Far from home" pill and starts the heartbeat. */
export const DANGER_SHOW = 0.35;
/** localStorage flag for the "danger warnings" setting; anything but '0' is on. */
export const DANGER_WARNINGS_KEY = 'territory-wars.dangerWarnings';

/** Trail exposure: none up to TRAIL_SAFE u of trail, full at TRAIL_SAFE + TRAIL_SPAN. */
const TRAIL_SAFE = 6;
const TRAIL_SPAN = 34;
/** Rival proximity: full within RIVAL_NEAR u of the trail or head, none past RIVAL_NEAR + RIVAL_SPAN. */
const RIVAL_NEAR = 3;
const RIVAL_SPAN = 12;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

type FlagStore = { getItem(key: string): string | null };

/**
 * The "danger warnings" setting (Task 7 adds its toggle). On when storage is unavailable;
 * storage is looked up inside the try, since touching blocked localStorage throws.
 */
export function dangerWarningsEnabled(store?: FlagStore): boolean {
  try {
    return (store ?? globalThis.localStorage)?.getItem(DANGER_WARNINGS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The human is out of its land with a live trail (not home, not down, not over). */
function exposed(world: World): boolean {
  const h = world.players[world.humanId];
  return h.alive && !world.awaitingRevive && !world.over && h.trail.length > 0;
}

/**
 * Danger for the human in [0, 1]: the larger of trail exposure and the nearest alive
 * rival head's closeness to the human's trail or head. 0 at home, dead or awaiting revive.
 */
export function dangerLevel(world: World): number {
  if (!exposed(world)) return 0;
  const h = world.players[world.humanId];
  const exposure = clamp01((trailLength(h) - TRAIL_SAFE) / TRAIL_SPAN);
  if (exposure >= 1) return 1;

  // Bounding box of trail + head, so far-away rivals skip the per-segment scan.
  const t = h.trail;
  let minX = h.pos.x, maxX = minX, minY = h.pos.y, maxY = minY;
  for (let i = 0; i < t.length; i++) {
    const p = t[i];
    if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
  }
  const reach = RIVAL_NEAR + RIVAL_SPAN;
  let d = Infinity;
  for (const r of world.players) {
    if (r.isHuman || !r.alive) continue;
    const q = r.pos;
    const bx = q.x < minX ? minX - q.x : q.x > maxX ? q.x - maxX : 0;
    const by = q.y < minY ? minY - q.y : q.y > maxY ? q.y - maxY : 0;
    if (bx * bx + by * by >= Math.min(d, reach) ** 2) continue;
    for (let i = 0; i < t.length; i++) {
      const dd = distPointSeg(q, t[i], i + 1 < t.length ? t[i + 1] : h.pos);
      if (dd < d) d = dd;
    }
  }
  const proximity = d === Infinity ? 0 : clamp01(1 - (d - RIVAL_NEAR) / RIVAL_SPAN);
  return exposure > proximity ? exposure : proximity;
}

/** What burnProgress remembers for one round: the burn it saw and the gap it started with. */
export type BurnCache = { burn: Burn | null; initialGap: number };

export function createBurnCache(): BurnCache {
  return { burn: null, initialGap: 0 };
}

/**
 * How far the burn has closed in on the human's head, in [0, 1] (0 when first seen, 1 at
 * the head), or null when the trail isn't burning. The starting gap is cached per burn.
 */
export function burnProgress(world: World, cache: BurnCache): number | null {
  const h = world.players[world.humanId];
  const b = h.alive ? h.burn : null;
  if (!b) {
    cache.burn = null;
    return null;
  }
  const remaining = Math.max(0, trailLength(h) - b.front);
  if (cache.burn !== b) {
    cache.burn = b;
    cache.initialGap = remaining;
  }
  if (cache.initialGap <= 0) return 1;
  return clamp01(1 - remaining / cache.initialGap);
}

/**
 * Nearest point to p on the boundary of land, written to out. Returns the distance, or
 * Infinity (out untouched) for empty land. With outerOnly, holes are ignored.
 */
export function nearestPointOnLand(land: MultiPoly, p: Vec, out: { x: number; y: number }, outerOnly = false): number {
  let best = Infinity, bx = 0, by = 0;
  for (const poly of land) {
    const rings = outerOnly ? Math.min(1, poly.length) : poly.length;
    for (let r = 0; r < rings; r++) {
      const ring = poly[r];
      const n = ring.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = ring[j], b = ring[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const k = len2 > 0 ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2) : 0;
        const x = a.x + dx * k, y = a.y + dy * k;
        const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d2 < best) { best = d2; bx = x; by = y; }
      }
    }
  }
  if (best === Infinity) return Infinity;
  out.x = bx;
  out.y = by;
  return Math.sqrt(best);
}

export type HomeTarget = { point: Vec; dist: number };

const sharedTarget: HomeTarget = { point: { x: 0, y: 0 }, dist: 0 };

/**
 * The nearest point of the human's own land's outer rings and its distance, or null while
 * the human is inside its land (or has none, or is dead). The result is written into `out`
 * (a shared object by default), so it is only valid until the next call.
 */
export function homeTarget(world: World, out: HomeTarget = sharedTarget): HomeTarget | null {
  const h = world.players[world.humanId];
  if (!h.alive || h.land.length === 0 || landContains(h.land, h.pos)) return null;
  const d = nearestPointOnLand(h.land, h.pos, out.point, true);
  if (d === Infinity) return null;
  out.dist = d;
  return out;
}

/** Everything the shell needs about danger for one frame; refresh it with sampleDanger. */
export type DangerState = {
  /** dangerLevel, or 0 when the "danger warnings" setting is off. */
  level: number;
  /** burnProgress (shown whatever the setting: a burning trail is never optional news). */
  burn: number | null;
  /** The home target while burning (else null); points into `target`. */
  home: HomeTarget | null;
  warnings: boolean;
  cache: BurnCache;
  target: HomeTarget;
};

export function createDangerState(warnings: boolean = dangerWarningsEnabled()): DangerState {
  return {
    level: 0, burn: null, home: null, warnings,
    cache: createBurnCache(), target: { point: { x: 0, y: 0 }, dist: 0 },
  };
}

/** Refreshes s from world (no allocation). */
export function sampleDanger(world: World, s: DangerState): void {
  s.level = s.warnings ? dangerLevel(world) : 0;
  s.burn = burnProgress(world, s.cache);
  s.home = s.burn === null ? null : homeTarget(world, s.target);
}
