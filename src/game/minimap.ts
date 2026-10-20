import { CONFIG } from '../sim/config';
import type { World } from '../sim/types';
import type { Camera } from './camera';
import { PALETTE } from './palette';
import { interpPos, landPath, playerColors } from './render';

/** Gap between the arena edge and the minimap edge, in CSS px. */
const PAD_PX = 4;
const BOT_DOT_PX = 2.5;
const HUMAN_DOT_PX = 4;
const TRAIL_PX = 1.5;

export type MinimapTransform = { scale: number; offset: number };

/** Maps world coords (arena centred at 0,0) onto a square minimap `sizePx` wide. */
export function minimapTransform(sizePx: number, arenaR = CONFIG.ARENA_R, padPx = PAD_PX): MinimapTransform {
  const scale = Math.max(0, sizePx / 2 - padPx) / arenaR;
  return { scale, offset: sizePx / 2 };
}

/**
 * Draws the whole arena: every player's land, live trails, heads (the human
 * larger, ringed in white) and the camera's current view rectangle.
 * `ctx` is the minimap canvas context; `sizePx` its CSS size; `dpr` its pixel ratio.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  sizePx: number,
  dpr: number,
  alpha: number,
  cam?: Camera,
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
    if (!p.land.length) continue;
    ctx.fillStyle = playerColors(p.colorIndex).base;
    ctx.fill(landPath(p.land), 'evenodd');
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = TRAIL_PX / s;
  for (const p of world.players) {
    if (!p.alive || p.trail.length === 0) continue;
    const head = interpPos(p, alpha);
    ctx.beginPath();
    ctx.moveTo(p.trail[0].x, p.trail[0].y);
    for (let i = 1; i < p.trail.length; i++) ctx.lineTo(p.trail[i].x, p.trail[i].y);
    ctx.lineTo(head.x, head.y);
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
  const alive = world.players.filter((p) => p.alive);
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
  ctx.restore();
}
