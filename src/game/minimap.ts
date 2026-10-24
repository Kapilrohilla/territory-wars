import { CONFIG } from '../sim/config';
import type { World } from '../sim/types';
import type { Camera } from './camera';
import { PALETTE } from './palette';
import type { Threat } from './threats';
import { addTrailPath, interpPos, landPath, playerColors, shownHeads, shownLand } from './render';

/** Gap between the arena edge and the minimap edge, in CSS px. */
const PAD_PX = 4;
const BOT_DOT_PX = 2.5;
const HUMAN_DOT_PX = 4;
const TRAIL_PX = 1.5;
/** Threat rivals' dots get a red ring this far out from the dot, in CSS px. */
const THREAT_RING_GAP_PX = 1.8;
const THREAT_RING_PX = 1.5;
const THREAT_RING = '#B4232F';

export type MinimapTransform = { scale: number; offset: number };

/** Maps world coords (arena centred at 0,0) onto a square minimap `sizePx` wide. */
export function minimapTransform(sizePx: number, arenaR = CONFIG.ARENA_R, padPx = PAD_PX): MinimapTransform {
  const scale = Math.max(0, sizePx / 2 - padPx) / arenaR;
  return { scale, offset: sizePx / 2 };
}

/**
 * Draws the whole arena: every player's land, live trails, heads (the human
 * larger, ringed in white) and the camera's current view rectangle. Rivals in `threats`
 * (threats.ts) get a red ring around their dot.
 * `ctx` is the minimap canvas context; `sizePx` its CSS size; `dpr` its pixel ratio.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  sizePx: number,
  dpr: number,
  alpha: number,
  cam?: Camera,
  threats?: readonly Threat[],
): void {
  const { scale: s, offset } = minimapTransform(sizePx);
  const R = CONFIG.ARENA_R;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, sizePx, sizePx);

  ctx.save();
  ctx.translate(offset, offset);
  ctx.scale(s, s);

  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.arena;
  ctx.fill();
  ctx.save();
  ctx.clip();

  for (const p of world.players) {
    const land = shownLand(world, p); // keeps a knocked-out human's land while it may come back
    if (!land.length) continue;
    ctx.fillStyle = playerColors(p.colorIndex).base;
    ctx.fill(landPath(land), 'evenodd');
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = TRAIL_PX / s;
  for (const p of world.players) {
    if (!p.alive || p.trail.length === 0) continue;
    const head = interpPos(p, alpha);
    ctx.beginPath();
    addTrailPath(ctx, p, head); // skips a burning trail's burnt range
    ctx.strokeStyle = playerColors(p.colorIndex).lip;
    ctx.stroke();
  }

  if (cam) {
    const hw = cam.viewW / (2 * cam.scale());
    ctx.strokeStyle = 'rgba(52, 50, 63, 0.35)';
    ctx.lineWidth = 1 / s;
    ctx.strokeRect(cam.x - hw, cam.y - cam.halfHeight, hw * 2, cam.halfHeight * 2);
  }
  ctx.restore(); // clip

  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(52, 50, 63, 0.25)';
  ctx.lineWidth = 1.5 / s;
  ctx.stroke();

  // Heads: bots first, human on top.
  const alive = shownHeads(world);
  alive.sort((a, b) => Number(a.isHuman) - Number(b.isHuman));
  for (const p of alive) {
    const h = interpPos(p, alpha);
    const r = (p.isHuman ? HUMAN_DOT_PX : BOT_DOT_PX) / s;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fillStyle = playerColors(p.colorIndex).lip;
    ctx.fill();
    if (p.isHuman) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / s;
      ctx.stroke();
    }
  }
  if (threats) {
    ctx.strokeStyle = THREAT_RING;
    ctx.lineWidth = THREAT_RING_PX / s;
    for (const t of threats) {
      const p = world.players[t.id];
      if (!p || !p.alive) continue;
      const h = interpPos(p, alpha);
      ctx.beginPath();
      ctx.arc(h.x, h.y, (BOT_DOT_PX + THREAT_RING_GAP_PX) / s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
