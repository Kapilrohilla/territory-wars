import { CONFIG } from '../sim/config';
import { angleDiff, type MultiPoly, type Vec } from '../sim/geometry';
import type { Player, World } from '../sim/types';
import type { Camera } from './camera';
import type { Effects } from './effects';
import { PALETTE } from './palette';

export const LIP_OFFSET = 0.35;
const TRAIL_WIDTH = 0.6;
const HEAD_SIZE = 1.2;
const HEAD_RADIUS = 0.3;
const HEAD_SIDE = 0.22;
const GRID_STEP = 5;
const NAME_OFFSET = 1.5;

/** Render-side state that spans frames. */
export type Fx = {
  /** Each player's heading before the latest step, for interpolation. */
  prevHeading: Map<number, number>;
};

export function createFx(): Fx {
  return { prevHeading: new Map() };
}

/** Call right before each sim step. */
export function snapshotFx(fx: Fx, world: World): void {
  for (const p of world.players) fx.prevHeading.set(p.id, p.heading);
}

export function interpPos(p: Player, alpha: number): Vec {
  return {
    x: p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha,
    y: p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha,
  };
}

function interpHeading(fx: Fx, p: Player, alpha: number): number {
  const prev = fx.prevHeading.get(p.id);
  if (prev === undefined) return p.heading;
  return prev + angleDiff(p.heading, prev) * alpha;
}

// Sim replaces land arrays on change, so array identity is the cache key.
const pathCache = new WeakMap<MultiPoly, Path2D>();

export function landPath(m: MultiPoly): Path2D {
  let path = pathCache.get(m);
  if (path) return path;
  path = new Path2D();
  for (const poly of m) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      path.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) path.lineTo(ring[i].x, ring[i].y);
      path.closePath();
    }
  }
  pathCache.set(m, path);
  return path;
}

export function playerColors(colorIndex: number) {
  const n = PALETTE.players.length;
  return PALETTE.players[((colorIndex % n) + n) % n];
}

function colors(p: Player) {
  return playerColors(p.colorIndex);
}

/** Land with fading-in regions cut out (regions are subsets of land, so evenodd subtracts). */
function maskedPath(m: MultiPoly, masks: MultiPoly[] | undefined): Path2D {
  const base = landPath(m);
  if (!masks || masks.length === 0) return base;
  const path = new Path2D();
  path.addPath(base);
  for (const r of masks) path.addPath(landPath(r));
  return path;
}

function drawArena(ctx: CanvasRenderingContext2D, cam: Camera, s: number): void {
  const R = CONFIG.ARENA_R;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.arena;
  ctx.fill();

  ctx.save();
  ctx.clip();
  const hw = cam.viewW / (2 * s), hh = cam.halfHeight;
  const x0 = Math.max(-R, Math.floor((cam.x - hw) / GRID_STEP) * GRID_STEP);
  const x1 = Math.min(R, cam.x + hw);
  const y0 = Math.max(-R, Math.floor((cam.y - hh) / GRID_STEP) * GRID_STEP);
  const y1 = Math.min(R, cam.y + hh);
  ctx.beginPath();
  for (let x = x0; x <= x1; x += GRID_STEP) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = y0; y <= y1; y += GRID_STEP) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1 / s;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(60, 60, 80, 0.18)';
  ctx.lineWidth = 2 / s;
  ctx.stroke();
}

/**
 * The land to draw for p: its land, or, while the human is knocked out awaiting a revive,
 * the land it held at the down (it may come straight back, so it stays put meanwhile).
 */
export function shownLand(world: World, p: Player): MultiPoly {
  if (p.isHuman && world.awaitingRevive && !p.alive) return p.dyingLand ?? [];
  return p.land;
}

/** Players whose head is drawn: the living, plus the knocked-out human awaiting a revive. */
export function shownHeads(world: World): Player[] {
  return world.players.filter((p) => p.alive || (p.isHuman && world.awaitingRevive));
}

const PROTECT_BLINK_HZ = 3;

/**
 * Head opacity: a soft pulse at PROTECT_BLINK_HZ while p is protected after a revive (the
 * shield bubble carries the message; the blink only hints at it). Steady under reduced motion.
 */
export function headAlpha(world: World, p: Player, reduced = false): number {
  if (world.time >= p.protectedUntil || reduced) return 1;
  return 0.75 + 0.25 * (0.5 + 0.5 * Math.cos(world.time * PROTECT_BLINK_HZ * Math.PI * 2));
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

let motionQuery: MediaQueryList | null | undefined;

/** prefers-reduced-motion, or the UI's `tw-reduced-motion` class on <html>. */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.classList.contains('tw-reduced-motion')) return true;
  if (motionQuery === undefined) {
    motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return motionQuery?.matches ?? false;
}

/** Last stretch (s) of the post-revive protection over which the shield fades out. */
export const SHIELD_FADE_S = 0.3;

/** Share of the shield ring left: 1 just after a revive, draining to 0 as protection ends. */
export function shieldFraction(remaining: number, total: number = CONFIG.REVIVE_PROTECT_S): number {
  return total > 0 ? clamp01(remaining / total) : 0;
}

/** Shield opacity: full until the last SHIELD_FADE_S, then eases out to 0. */
export function shieldAlpha(remaining: number): number {
  const u = clamp01(remaining / SHIELD_FADE_S);
  return u * u * (3 - 2 * u);
}

const VIGNETTE_HZ = 1.5;

/** Burning-trail screen-edge vignette opacity: a slow pulse, or a lower steady glow under reduced motion. */
export function vignetteAlpha(time: number, reduced: boolean): number {
  if (reduced) return 0.3;
  return 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(time * VIGNETTE_HZ * Math.PI * 2));
}

/** Path length over which an ash dot fades after a burn front passes it. */
export const ASH_FADE_LEN = 6;

/**
 * Opacity (0..1) of an ash dot at path length x of a trail burnt over [back, front]: newest
 * (next to a front) is darkest, fading with distance behind the front that passed it.
 */
export function ashAlpha(x: number, s0: number, back: number, front: number): number {
  if (x < back || x > front) return 0;
  const behind = x >= s0 ? front - x : x - back;
  return clamp01(1 - behind / ASH_FADE_LEN);
}

/**
 * Nearest point to p on the boundary of land (every ring), written to out. Returns the
 * distance, or Infinity (out untouched) for empty land. For a p outside the land, that
 * is the nearest point of the land itself.
 */
export function nearestPointOnLand(land: MultiPoly, p: Vec, out: { x: number; y: number }): number {
  let best = Infinity, bx = 0, by = 0;
  for (const poly of land) {
    for (const ring of poly) {
      const n = ring.length;
      if (n === 0) continue;
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

// Dying land is drawn (shrinking) by the effects layer, not here.
function drawLands(ctx: CanvasRenderingContext2D, world: World, effects?: Effects): void {
  const items: { path: Path2D; p: Player }[] = [];
  for (const p of world.players) {
    const land = shownLand(world, p);
    if (land.length) items.push({ path: maskedPath(land, effects?.landMask(p.id)), p });
  }
  // All lips first, then all tops: a neighbour's top occludes the lip below it.
  ctx.save();
  ctx.translate(0, LIP_OFFSET);
  for (const it of items) {
    ctx.fillStyle = colors(it.p).lip;
    ctx.fill(it.path, 'evenodd');
  }
  ctx.restore();
  for (const it of items) {
    ctx.fillStyle = colors(it.p).base;
    ctx.fill(it.path, 'evenodd');
  }
}

const EMBER_R = 0.25;
const EMBER_FLICKER_HZ = 9;

/** Point at path length `at` along pts (cum[i] = path length at pts[i]), written to out. */
function pointAtInto(pts: Vec[], cum: number[], at: number, out: { x: number; y: number }): { x: number; y: number } {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < at) i++;
  const a = pts[i - 1], b = pts[i];
  const len = cum[i] - cum[i - 1];
  const k = len > 0 ? Math.max(0, Math.min(1, (at - cum[i - 1]) / len)) : 0;
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  return out;
}

/** Point at path length s along trail + head (s from trail[0]); clamps to the ends. */
export function pointOnTrail(trail: Vec[], head: Vec, s: number): Vec {
  if (trail.length === 0) return { x: head.x, y: head.y };
  let acc = 0;
  for (let i = 0; i < trail.length; i++) {
    const a = trail[i], b = i + 1 < trail.length ? trail[i + 1] : head;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + len >= s) {
      const k = len > 0 ? clamp01((s - acc) / len) : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    acc += len;
  }
  return { x: head.x, y: head.y };
}

/** Adds the piece of the polyline between path lengths a and b as one sub-path. */
function addRange(ctx: CanvasRenderingContext2D, pts: Vec[], cum: number[], a: number, b: number): void {
  if (b <= a) return;
  const s = pointAtInto(pts, cum, a, scratch);
  ctx.moveTo(s.x, s.y);
  for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) ctx.lineTo(pts[i].x, pts[i].y);
  const e = pointAtInto(pts, cum, b, scratch);
  ctx.lineTo(e.x, e.y);
}

const EMBER_GLOW_R = EMBER_R * 5.5;
const EMBER_SPRITE_PX = 64;
let emberSprite: HTMLCanvasElement | null = null;

/** Ember glow (#FF7A59 core, #FFB347 halo), drawn once into an offscreen canvas and reused (no per-frame shadowBlur). */
function getEmberSprite(): HTMLCanvasElement | null {
  if (emberSprite) return emberSprite;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = EMBER_SPRITE_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  const r = EMBER_SPRITE_PX / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255, 122, 89, 1)');
  grad.addColorStop(0.22, 'rgba(255, 140, 80, 0.85)');
  grad.addColorStop(0.5, 'rgba(255, 179, 71, 0.45)');
  grad.addColorStop(1, 'rgba(255, 179, 71, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, EMBER_SPRITE_PX, EMBER_SPRITE_PX);
  emberSprite = c;
  return c;
}

function drawEmber(ctx: CanvasRenderingContext2D, at: Vec, time: number, phase: number): void {
  const f = 0.5 + 0.5 * Math.sin((time * EMBER_FLICKER_HZ + phase) * Math.PI * 2);
  const sprite = getEmberSprite();
  if (sprite) {
    const gr = EMBER_GLOW_R * (0.75 + 0.5 * f);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = prevAlpha * (0.7 + 0.3 * f);
    ctx.drawImage(sprite, at.x - gr, at.y - gr, gr * 2, gr * 2);
    ctx.globalAlpha = prevAlpha;
  }
  ctx.beginPath();
  ctx.arc(at.x, at.y, EMBER_R * (0.85 + 0.3 * f), 0, Math.PI * 2);
  ctx.fillStyle = EMBER_CORE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(at.x, at.y, EMBER_R * (0.35 + 0.2 * f), 0, Math.PI * 2);
  ctx.fillStyle = EMBER_HOT;
  ctx.fill();
}

const EMBER_CORE = '#FF7A59';
const EMBER_HOT = '#FFB347';
const ASH_STEP = 0.7;
const ASH_R = 0.17;
const ASH_COLOR = '#6E6B78';
const ASH_ALPHA = 0.55;
const scratch = { x: 0, y: 0 };

/** Faint grey ash dots over the burnt range, anchored at s0 so they stay put while fading. */
function drawAsh(ctx: CanvasRenderingContext2D, poly: TrailPoly, s0: number, back: number, front: number): void {
  const { pts, cum } = poly;
  ctx.fillStyle = ASH_COLOR;
  const prevAlpha = ctx.globalAlpha;
  // Two sides of s0: k < 0 runs towards back, k >= 0 towards front. Only dots within
  // ASH_FADE_LEN of their front are visible, so start there.
  const kFront0 = Math.max(0, Math.ceil((front - ASH_FADE_LEN - s0) / ASH_STEP));
  const kBack0 = Math.max(1, Math.ceil((s0 - back - ASH_FADE_LEN) / ASH_STEP));
  for (let side = 0; side < 2; side++) {
    for (let k = side === 0 ? kFront0 : kBack0; ; k++) {
      const x = side === 0 ? s0 + k * ASH_STEP : s0 - k * ASH_STEP;
      if (x > front || x < back) break;
      const a = ashAlpha(x, s0, back, front);
      if (a <= 0) continue;
      pointAtInto(pts, cum, x, scratch);
      // Cheap per-dot size jitter, stable for a given dot.
      const j = Math.sin((side ? -k : k) * 12.9898) * 0.5 + 0.5;
      ctx.globalAlpha = prevAlpha * ASH_ALPHA * a;
      ctx.beginPath();
      ctx.arc(scratch.x, scratch.y, ASH_R * (0.85 + 0.3 * j), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = prevAlpha;
}

/** Path-length table for a trail polyline (trail + head); `at` positions run from trail[0]. */
export type TrailPoly = { pts: Vec[]; cum: number[]; total: number };

/**
 * Adds p's trail (live tail to `head` included) to the current path, skipping the burnt
 * range [back, front] when it is burning. Shared by the main renderer and the minimap.
 * Returns the polyline table (for embers), or null for an empty trail.
 */
export function addTrailPath(ctx: CanvasRenderingContext2D, p: Player, head: Vec): TrailPoly | null {
  const t = p.trail;
  if (t.length === 0) return null;
  const burn = p.burn;
  if (!burn) {
    ctx.moveTo(t[0].x, t[0].y);
    for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y);
    ctx.lineTo(head.x, head.y); // live tail so the ribbon never lags the head
    return null;
  }
  // Path lengths run from trail[0] to the head.
  const pts = t.concat([head]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  addRange(ctx, pts, cum, 0, burn.back);
  addRange(ctx, pts, cum, burn.front, total);
  return { pts, cum, total };
}

function drawTrail(ctx: CanvasRenderingContext2D, p: Player, head: Vec, time: number): void {
  if (p.trail.length === 0) return;
  ctx.beginPath();
  const poly = addTrailPath(ctx, p, head);
  ctx.strokeStyle = colors(p).trail;
  ctx.lineWidth = TRAIL_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  const burn = p.burn;
  if (burn && poly && poly.pts.length > 1) {
    const { pts, cum, total } = poly;
    drawAsh(ctx, poly, burn.s0, burn.back, Math.min(burn.front, total));
    if (burn.back > 0) drawEmber(ctx, pointAtInto(pts, cum, burn.back, scratch), time, 0);
    drawEmber(ctx, pointAtInto(pts, cum, Math.min(burn.front, total), scratch), time, 0.5);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHead(ctx: CanvasRenderingContext2D, p: Player, head: Vec, heading: number): void {
  const c = colors(p);
  const h = HEAD_SIZE / 2;
  // Side face: same square shifted down, darkened.
  ctx.save();
  ctx.translate(head.x, head.y + HEAD_SIDE);
  ctx.rotate(heading);
  roundRect(ctx, -h, -h, HEAD_SIZE, HEAD_SIZE, HEAD_RADIUS);
  ctx.fillStyle = c.lip;
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
  ctx.restore();
  // Top face.
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(heading);
  roundRect(ctx, -h, -h, HEAD_SIZE, HEAD_SIZE, HEAD_RADIUS);
  ctx.fillStyle = c.lip;
  ctx.fill();
  ctx.restore();
}

const SHIELD = '#6CC3EF';
const SHIELD_R = 1.25;
const SHIELD_RING_W = 0.16;
const SHIELD_SPRITE_PX = 96;
let shieldSprite: HTMLCanvasElement | null = null;

/** Cyan bubble: clear centre, bright rim, soft outer glow. Drawn once and reused. */
function getShieldSprite(): HTMLCanvasElement | null {
  if (shieldSprite) return shieldSprite;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = SHIELD_SPRITE_PX;
  const g = c.getContext('2d');
  if (!g) return null;
  const r = SHIELD_SPRITE_PX / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  grad.addColorStop(0.55, 'rgba(210, 240, 253, 0.28)');
  grad.addColorStop(0.7, 'rgba(108, 195, 239, 0.8)');
  grad.addColorStop(0.74, 'rgba(240, 250, 255, 0.85)');
  grad.addColorStop(0.8, 'rgba(108, 195, 239, 0.45)');
  grad.addColorStop(1, 'rgba(108, 195, 239, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, SHIELD_SPRITE_PX, SHIELD_SPRITE_PX);
  shieldSprite = c;
  return c;
}

/** Post-revive shield around the head, with a ring that drains as protection runs out. */
function drawShield(ctx: CanvasRenderingContext2D, head: Vec, remaining: number, time: number, reduced: boolean): void {
  const a = shieldAlpha(remaining);
  if (a <= 0) return;
  const cx = head.x, cy = head.y + HEAD_SIDE / 2;
  const pulse = reduced ? 1 : 1 + 0.04 * Math.sin(time * 2 * Math.PI * 2);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * a;
  const sprite = getShieldSprite();
  if (sprite) {
    // The sprite's rim sits at 0.74 of its radius.
    const gr = (SHIELD_R / 0.74) * pulse;
    ctx.drawImage(sprite, cx - gr, cy - gr, gr * 2, gr * 2);
  }
  const rr = (SHIELD_R + 0.35) * pulse;
  ctx.lineCap = 'round';
  // White track under the ring keeps it readable on any land colour.
  ctx.lineWidth = SHIELD_RING_W * 2.2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, Math.PI * 2);
  ctx.stroke();
  const frac = shieldFraction(remaining);
  if (frac > 0) {
    ctx.lineWidth = SHIELD_RING_W;
    ctx.strokeStyle = SHIELD;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = prevAlpha;
}

const HOME_ARROW_COLOR = '#B4232F';
const HOME_ARROW_GAP = 1.1;
const HOME_ARROW_MAX = 7;
const HOME_ARROW_DOT = 0.7;
const HOME_ARROW_HEAD = 0.55;
const homeTarget = { x: 0, y: 0 };

/** Dotted arrow from the head towards the nearest point of the player's own land. */
function drawHomeArrow(ctx: CanvasRenderingContext2D, land: MultiPoly, head: Vec): void {
  const d = nearestPointOnLand(land, head, homeTarget);
  if (!(d > HOME_ARROW_GAP + HOME_ARROW_HEAD)) return; // no land, or already at the edge
  const ux = (homeTarget.x - head.x) / d, uy = (homeTarget.y - head.y) / d;
  const end = Math.min(d, HOME_ARROW_GAP + HOME_ARROW_MAX);
  ctx.fillStyle = HOME_ARROW_COLOR;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * 0.85;
  ctx.beginPath();
  for (let t = HOME_ARROW_GAP; t < end - HOME_ARROW_HEAD; t += HOME_ARROW_DOT) {
    const x = head.x + ux * t, y = head.y + uy * t;
    ctx.moveTo(x + 0.13, y);
    ctx.arc(x, y, 0.13, 0, Math.PI * 2);
  }
  ctx.fill();
  // Chevron head at the end.
  const tx = head.x + ux * end, ty = head.y + uy * end;
  const bx = tx - ux * HOME_ARROW_HEAD, by = ty - uy * HOME_ARROW_HEAD;
  const w = HOME_ARROW_HEAD * 0.7;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(bx - uy * w, by + ux * w);
  ctx.lineTo(bx + uy * w, by - ux * w);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = prevAlpha;
}

let vignette: CanvasGradient | null = null;

/** Soft orange-red edge glow (screen space) while the human's own trail burns. */
function drawBurnVignette(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, reduced: boolean): void {
  // Built once in a unit square and stretched to the screen, so it hugs every edge (an ellipse).
  if (!vignette) {
    vignette = ctx.createRadialGradient(0, 0, 0.75, 0, 0, Math.SQRT2);
    vignette.addColorStop(0, 'rgba(255, 122, 89, 0)');
    vignette.addColorStop(0.45, 'rgba(255, 110, 80, 0.22)');
    vignette.addColorStop(1, 'rgba(230, 70, 55, 0.5)');
  }
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2);
  ctx.globalAlpha = vignetteAlpha(time, reduced);
  ctx.fillStyle = vignette;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/**
 * Draws the world. Expects ctx's transform to map CSS pixels (DPR applied by
 * the caller) and `cam` to be updated for this frame.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  alpha: number,
  fx: Fx,
  effects?: Effects,
): void {
  effects?.observe(world);
  const reduced = prefersReducedMotion();
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, cam.viewW, cam.viewH);

  const s = cam.scale();
  ctx.save();
  ctx.translate(cam.viewW / 2, cam.viewH / 2);
  ctx.scale(s, s);
  ctx.translate(-cam.x, -cam.y);

  drawArena(ctx, cam, s);
  drawLands(ctx, world, effects);
  effects?.drawWorld(ctx);

  const alive = shownHeads(world);
  const heads = new Map<number, Vec>();
  for (const p of alive) heads.set(p.id, interpPos(p, alpha));
  for (const p of alive) drawTrail(ctx, p, heads.get(p.id)!, world.time);
  // Human last so it stays on top.
  const order = alive.filter((p) => !p.isHuman).concat(alive.filter((p) => p.isHuman));
  const human = world.players[world.humanId];
  const humanHead = human.alive ? heads.get(human.id) : undefined;
  if (humanHead && human.burn) drawHomeArrow(ctx, human.land, humanHead);
  for (const p of order) {
    // The shield sits just under the human's head, so the head stays crisp inside it.
    if (p === human && humanHead && world.time < human.protectedUntil) {
      drawShield(ctx, humanHead, human.protectedUntil - world.time, world.time, reduced);
    }
    ctx.globalAlpha = headAlpha(world, p, reduced);
    drawHead(ctx, p, heads.get(p.id)!, interpHeading(fx, p, alpha));
  }
  ctx.globalAlpha = 1;
  effects?.drawWorldTop(ctx);
  ctx.restore();

  // Names in screen space so text size is independent of zoom.
  ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(40, 40, 55, 0.6)';
  for (const p of order) {
    const h = heads.get(p.id)!;
    const sp = cam.worldToScreen({ x: h.x, y: h.y - NAME_OFFSET });
    ctx.fillText(p.name, sp.x, sp.y);
  }

  if (humanHead && human.burn) drawBurnVignette(ctx, cam.viewW, cam.viewH, world.time, reduced);
  effects?.draw(ctx, cam);
}
