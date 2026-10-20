import { CONFIG } from '../sim/config';
import type { MultiPoly, Vec } from '../sim/geometry';
import type { GameEvent, World } from '../sim/types';
import type { Camera } from './camera';
import { LIP_OFFSET, landPath, playerColors } from './render';
import { playPop } from './sound';

const CAPTURE_S = 0.2;
const CAPTURE_SCALE0 = 1.04;
const TEXT_S = 0.9;
const TEXT_RISE = 2;
const TEXT_POP_S = 0.12;
const NUDGE = 0.3;
const VIBRATE_MS = 15;
const DYING_ALPHA0 = 0.85;

type CaptureFx = { playerId: number; colorIndex: number; region: MultiPoly; c: Vec; t: number };
type TextFx = { text: string; colorIndex: number; at: Vec; t: number };
type DyingFx = { colorIndex: number; land: MultiPoly; c: Vec; t: number };

export type Effects = {
  onEvents(events: GameEvent[], world: World, cam: Pick<Camera, 'nudge'>): void;
  update(dt: number): void;
  /** Regions still fading in, to be cut out of the owner's land this frame. */
  landMask(playerId: number): MultiPoly[] | undefined;
  /** World-space layer (capture fade-ins, death shrink); call inside the camera transform. */
  drawWorld(ctx: CanvasRenderingContext2D): void;
  /** Screen-space layer (floating "+x.x%"); call with ctx in CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera): void;
  /** True while any effect is still animating. */
  busy(): boolean;
};

/** "+x.x%" with one decimal. */
export function formatGain(gainedPct: number): string {
  return `+${Math.max(0, gainedPct).toFixed(1)}%`;
}

/** Area-weighted centroid of a MultiPoly's outer rings; bbox centre as fallback. */
export function centroid(m: MultiPoly): Vec {
  let a = 0, cx = 0, cy = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of m) {
    const r = poly[0];
    if (!r || r.length < 3) continue;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const p = r[i], q = r[j];
      const cross = q.x * p.y - p.x * q.y;
      a += cross;
      cx += (q.x + p.x) * cross;
      cy += (q.y + p.y) * cross;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (Math.abs(a) > 1e-9) return { x: cx / (3 * a), y: cy / (3 * a) };
  if (minX === Infinity) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInQuad = (t: number) => t * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function fillShape(ctx: CanvasRenderingContext2D, m: MultiPoly, colorIndex: number, alpha: number): void {
  const c = playerColors(colorIndex);
  const path = landPath(m);
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(0, LIP_OFFSET);
  ctx.fillStyle = c.lip;
  ctx.fill(path, 'evenodd');
  ctx.restore();
  ctx.fillStyle = c.base;
  ctx.fill(path, 'evenodd');
}

function scaledAbout(ctx: CanvasRenderingContext2D, c: Vec, k: number): void {
  ctx.translate(c.x, c.y);
  ctx.scale(k, k);
  ctx.translate(-c.x, -c.y);
}

export function createEffects(): Effects {
  let captures: CaptureFx[] = [];
  let texts: TextFx[] = [];
  let dying: DyingFx[] = [];

  return {
    onEvents(events, world, cam) {
      for (const e of events) {
        if (e.type === 'capture') {
          const p = world.players[e.playerId];
          if (e.region.length > 0) {
            captures.push({ playerId: p.id, colorIndex: p.colorIndex, region: e.region, c: centroid(e.region), t: 0 });
          }
          if (p.isHuman && e.gainedPct > 0) {
            texts.push({ text: formatGain(e.gainedPct), colorIndex: p.colorIndex, at: { x: p.pos.x, y: p.pos.y }, t: 0 });
            cam.nudge(NUDGE);
            try { (globalThis.navigator as Navigator | undefined)?.vibrate?.(VIBRATE_MS); } catch { /* ignore */ }
            playPop();
          }
        } else if (e.type === 'death') {
          const p = world.players[e.playerId];
          const land = p.dyingLand && p.dyingLand.length ? p.dyingLand : p.land;
          if (land.length) dying.push({ colorIndex: p.colorIndex, land, c: centroid(land), t: 0 });
          // The owner's land is gone; any fade-in still pending for it is moot.
          captures = captures.filter((c) => c.playerId !== p.id);
        }
      }
    },

    update(dt) {
      if (captures.length) {
        for (const c of captures) c.t += dt;
        captures = captures.filter((c) => c.t < CAPTURE_S);
      }
      if (texts.length) {
        for (const t of texts) t.t += dt;
        texts = texts.filter((t) => t.t < TEXT_S);
      }
      if (dying.length) {
        for (const d of dying) d.t += dt;
        dying = dying.filter((d) => d.t < CONFIG.DEATH_SHRINK_S);
      }
    },

    landMask(playerId) {
      let out: MultiPoly[] | undefined;
      for (const c of captures) if (c.playerId === playerId) (out ??= []).push(c.region);
      return out;
    },

    drawWorld(ctx) {
      for (const d of dying) {
        const u = clamp01(d.t / CONFIG.DEATH_SHRINK_S);
        const k = 1 - easeInQuad(u) * 0.98;
        ctx.save();
        scaledAbout(ctx, d.c, k);
        fillShape(ctx, d.land, d.colorIndex, DYING_ALPHA0 * (1 - u));
        ctx.restore();
      }
      for (const c of captures) {
        const u = easeOutCubic(clamp01(c.t / CAPTURE_S));
        ctx.save();
        scaledAbout(ctx, c.c, CAPTURE_SCALE0 + (1 - CAPTURE_SCALE0) * u);
        fillShape(ctx, c.region, c.colorIndex, u);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },

    draw(ctx, cam) {
      if (!texts.length) return;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (const t of texts) {
        const u = clamp01(t.t / TEXT_S);
        const sp = cam.worldToScreen({ x: t.at.x, y: t.at.y - TEXT_RISE * easeOutCubic(u) - 1.6 });
        const pop = 0.6 + 0.4 * easeOutCubic(clamp01(t.t / TEXT_POP_S));
        const alpha = u < 0.5 ? 1 : 1 - easeInQuad((u - 0.5) / 0.5);
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${Math.round(22 * pop)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeText(t.text, sp.x, sp.y);
        ctx.fillStyle = playerColors(t.colorIndex).lip;
        ctx.fillText(t.text, sp.x, sp.y);
      }
      ctx.restore();
    },

    busy() {
      return captures.length > 0 || texts.length > 0 || dying.length > 0;
    },
  };
}
