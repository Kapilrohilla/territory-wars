/**
 * Screen-space layer drawn over the world after render() each frame: the danger and
 * burning-trail vignettes and the gold home arrow with its distance chip. Later layers
 * (threat arrows, the touch joystick) hang off the same update/draw pair.
 */
import type { World } from '../sim/types';
import type { Camera } from './camera';
import type { DangerState } from './danger';
import { prefersReducedMotion } from './render';
import { burnVignetteAlpha } from './tension';

export type Overlay = {
  /** Once per frame, before draw: real dt (s) and the render interpolation alpha. */
  update(world: World, cam: Camera, dt: number, alpha: number): void;
  /** Draws in CSS pixels (ctx transform = DPR only), after render(). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera): void;
};

/** Home arrow tail: this far (world units) from the head toward home. */
export const HOME_ARROW_DIST = 2.2;

const GOLD = '#FFC93C';
const GOLD_LIP = '#C99A1E';
const INK = '#34323F';
const EMBER = '#FF7A59';
const CHIP_LIP = '#D9D6CE';
const LIP_PX = 3;

/** Arrow shape (px), pointing +x and centred on 0: a shaft plus a wide head. */
const ARROW_LEN = 34;
const ARROW_HEAD_LEN = 16;
const ARROW_HEAD_W = 28;
const ARROW_SHAFT_W = 12;

const CHIP_H = 30;
const CHIP_PAD = 12;
const CHIP_DOT_R = 5;
const CHIP_GAP = 26;
const CHIP_FONT = '800 15px Rubik, system-ui, -apple-system, "Segoe UI", sans-serif';
const EDGE_MARGIN = 8;

let dangerGrad: CanvasGradient | null = null;
let burnGrad: CanvasGradient | null = null;
let arrowPath: Path2D | null = null;

/** Edge glow in a unit circle stretched over the screen, so it hugs every edge. */
function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, grad: CanvasGradient, alpha: number): void {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function getArrowPath(): Path2D {
  if (arrowPath) return arrowPath;
  const p = new Path2D();
  const x0 = -ARROW_LEN / 2, x1 = ARROW_LEN / 2, xh = x1 - ARROW_HEAD_LEN;
  const sw = ARROW_SHAFT_W / 2, hw = ARROW_HEAD_W / 2;
  p.moveTo(x0, -sw);
  p.lineTo(xh, -sw);
  p.lineTo(xh, -hw);
  p.lineTo(x1, 0);
  p.lineTo(xh, hw);
  p.lineTo(xh, sw);
  p.lineTo(x0, sw);
  p.closePath();
  arrowPath = p;
  return p;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

export function createOverlay(danger: DangerState): Overlay {
  let time = 0;
  let reduced = false;
  let showHome = false;
  /** Interpolated head and home point, world units. */
  let hx = 0, hy = 0, tx = 0, ty = 0;
  let homeDist = 0;
  /** Chip text cache: rebuilt only when the shown tenth changes. */
  let chipTenths = -1;
  let chipText = '';
  let chipTextW = 0;

  return {
    update(world, _cam, dt, alpha) {
      time += dt;
      reduced = prefersReducedMotion();
      const h = world.players[world.humanId];
      const home = danger.home;
      showHome = danger.burn !== null && home !== null && h.alive;
      if (showHome && home) {
        hx = h.prevPos.x + (h.pos.x - h.prevPos.x) * alpha;
        hy = h.prevPos.y + (h.pos.y - h.prevPos.y) * alpha;
        tx = home.point.x;
        ty = home.point.y;
        homeDist = home.dist;
      }
    },

    draw(ctx, cam) {
      const w = cam.viewW, h = cam.viewH;
      if (danger.burn !== null) {
        if (!burnGrad) {
          burnGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          burnGrad.addColorStop(0.5, 'rgba(255, 179, 71, 0)');
          burnGrad.addColorStop(0.78, 'rgba(255, 122, 89, 0.55)');
          burnGrad.addColorStop(1, 'rgba(230, 70, 55, 0.9)');
        }
        vignette(ctx, w, h, burnGrad, burnVignetteAlpha(danger.burn, time, reduced));
      } else if (danger.level > 0) {
        if (!dangerGrad) {
          dangerGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          dangerGrad.addColorStop(0.55, 'rgba(255, 122, 89, 0)');
          dangerGrad.addColorStop(1, 'rgba(255, 122, 89, 0.28)');
        }
        vignette(ctx, w, h, dangerGrad, danger.level);
      }
      if (showHome) drawHome(ctx, cam);
    },
  };

  function drawHome(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const dx = tx - hx, dy = ty - hy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len;
    const s = cam.scale();
    // Tail at HOME_ARROW_DIST from the head; (cx, cy) is the arrow's centre.
    const along = HOME_ARROW_DIST * s + ARROW_LEN / 2;
    const cx = (hx - cam.x) * s + cam.viewW / 2 + ux * along;
    const cy = (hy - cam.y) * s + cam.viewH / 2 + uy * along;
    const angle = Math.atan2(uy, ux);
    const path = getArrowPath();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.translate(cx, cy + LIP_PX);
    ctx.rotate(angle);
    ctx.fillStyle = GOLD_LIP;
    ctx.fill(path);
    ctx.strokeStyle = GOLD_LIP;
    ctx.lineWidth = 2.5;
    ctx.stroke(path);
    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = GOLD;
    ctx.fill(path);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.stroke(path);
    ctx.restore();

    // Distance chip beside the arrow, on its right-hand side (left near the screen edge).
    ctx.font = CHIP_FONT;
    const tenths = Math.round(homeDist * 10);
    if (tenths !== chipTenths) {
      chipTenths = tenths;
      chipText = `Home ${(tenths / 10).toFixed(1)}m`;
      chipTextW = ctx.measureText(chipText).width;
    }
    const cw = CHIP_PAD + CHIP_DOT_R * 2 + 8 + chipTextW + CHIP_PAD + 2;
    let px = -uy, py = ux;
    if (px < 0) { px = -px; py = -py; }
    const reach = CHIP_GAP + cw / 2;
    let ccx = cx + px * reach;
    if (ccx + cw / 2 > cam.viewW - EDGE_MARGIN) ccx = cx - px * reach;
    const ccy = cy + py * (CHIP_GAP + CHIP_H / 2);
    const x = Math.max(EDGE_MARGIN, Math.min(cam.viewW - EDGE_MARGIN - cw, ccx - cw / 2));
    const y = Math.max(EDGE_MARGIN, Math.min(cam.viewH - EDGE_MARGIN - CHIP_H - LIP_PX, ccy - CHIP_H / 2));

    pill(ctx, x, y + LIP_PX, cw, CHIP_H);
    ctx.fillStyle = CHIP_LIP;
    ctx.fill();
    pill(ctx, x, y, cw, CHIP_H);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + CHIP_PAD + CHIP_DOT_R, y + CHIP_H / 2, CHIP_DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = EMBER;
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(chipText, x + CHIP_PAD + CHIP_DOT_R * 2 + 8, y + CHIP_H / 2 + 1);
  }
}
