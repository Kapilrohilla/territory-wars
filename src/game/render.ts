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

// Dying land is drawn (shrinking) by the effects layer, not here.
function drawLands(ctx: CanvasRenderingContext2D, world: World, effects?: Effects): void {
  const items: { path: Path2D; p: Player }[] = [];
  for (const p of world.players) {
    if (p.land.length) items.push({ path: maskedPath(p.land, effects?.landMask(p.id)), p });
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

/** Point at path length `at` along pts (cum[i] = path length at pts[i]). */
function pointAt(pts: Vec[], cum: number[], at: number): Vec {
  let i = 1;
  while (i < pts.length - 1 && cum[i] < at) i++;
  const a = pts[i - 1], b = pts[i];
  const len = cum[i] - cum[i - 1];
  const k = len > 0 ? Math.max(0, Math.min(1, (at - cum[i - 1]) / len)) : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Adds the piece of the polyline between path lengths a and b as one sub-path. */
function addRange(ctx: CanvasRenderingContext2D, pts: Vec[], cum: number[], a: number, b: number): void {
  if (b <= a) return;
  const s = pointAt(pts, cum, a);
  ctx.moveTo(s.x, s.y);
  for (let i = 0; i < pts.length; i++) if (cum[i] > a && cum[i] < b) ctx.lineTo(pts[i].x, pts[i].y);
  const e = pointAt(pts, cum, b);
  ctx.lineTo(e.x, e.y);
}

function drawEmber(ctx: CanvasRenderingContext2D, at: Vec, time: number, phase: number): void {
  const f = 0.5 + 0.5 * Math.sin((time * EMBER_FLICKER_HZ + phase) * Math.PI * 2);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 120, 90, 0.9)';
  ctx.shadowBlur = 6 + 6 * f;
  ctx.beginPath();
  ctx.arc(at.x, at.y, EMBER_R * (0.85 + 0.3 * f), 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, ${Math.round(110 + 50 * f)}, ${Math.round(100 + 40 * f)}, ${0.75 + 0.25 * f})`;
  ctx.fill();
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, p: Player, head: Vec, time: number): void {
  const t = p.trail;
  if (t.length === 0) return;
  ctx.beginPath();
  const burn = p.burn;
  let pts: Vec[] = [], cum: number[] = [], total = 0;
  if (!burn) {
    ctx.moveTo(t[0].x, t[0].y);
    for (let i = 1; i < t.length; i++) ctx.lineTo(t[i].x, t[i].y);
    ctx.lineTo(head.x, head.y); // live tail so the ribbon never lags the head
  } else {
    // Skip the burnt range [back, front]; path lengths run from trail[0] to the head.
    pts = t.concat([head]);
    cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    total = cum[cum.length - 1];
    addRange(ctx, pts, cum, 0, burn.back);
    addRange(ctx, pts, cum, burn.front, total);
  }
  ctx.strokeStyle = colors(p).trail;
  ctx.lineWidth = TRAIL_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  if (burn && pts.length > 1) {
    if (burn.back > 0) drawEmber(ctx, pointAt(pts, cum, burn.back), time, 0);
    drawEmber(ctx, pointAt(pts, cum, Math.min(burn.front, total)), time, 0.5);
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

  const alive = world.players.filter((p) => p.alive);
  const heads = new Map<number, Vec>();
  for (const p of alive) heads.set(p.id, interpPos(p, alpha));
  for (const p of alive) drawTrail(ctx, p, heads.get(p.id)!, world.time);
  // Human last so it stays on top.
  const order = alive.filter((p) => !p.isHuman).concat(alive.filter((p) => p.isHuman));
  for (const p of order) drawHead(ctx, p, heads.get(p.id)!, interpHeading(fx, p, alpha));
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

  effects?.draw(ctx, cam);
}
