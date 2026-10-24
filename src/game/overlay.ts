/**
 * Screen-space layer drawn over the world after render() each frame: the danger and
 * burning-trail vignettes, the gold home arrow with its distance chip, and the edge arrows
 * pointing at off-screen threats. Later layers (the touch joystick) hang off the same
 * update/draw pair.
 */
import type { Player, World } from '../sim/types';
import type { Camera } from './camera';
import type { DangerState } from './danger';
import { drawFace } from './faces';
import { playerColors, prefersReducedMotion } from './render';
import type { Face } from './skins';
import { burnVignetteAlpha } from './tension';
import { MAX_THREATS, THREAT_RANGE, type Threat } from './threats';

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

/** Threat arrow: a round chip 34 px across with a tip pointing at the rival. */
const THREAT_CHIP_R = 17;
const THREAT_TIP = 25;
/** The chip sits this far inside the viewport edge. */
const THREAT_EDGE_INSET = 18;
const THREAT_FACE_PX = 16;
const THREAT_CLOSEST_SCALE = 1.15;
const THREAT_PULSE_HZ = 2;
const THREAT_FONT = '800 10px Rubik, system-ui, -apple-system, "Segoe UI", sans-serif';
/** "0m" … "18m", built once so labels never allocate per frame. */
const DIST_LABELS = Array.from({ length: THREAT_RANGE + 2 }, (_, i) => `${i}m`);

/** First-time tooltip beside the first threat arrow ever shown. */
export const THREAT_TIP_KEY = 'territory-wars.threatTipSeen';
export const THREAT_TIP_TEXT = 'Rival heading for your trail';
const THREAT_TIP_S = 2.5;
const TIP_FONT = '700 13px Rubik, system-ui, -apple-system, "Segoe UI", sans-serif';
const TIP_H = 28;
const TIP_PAD = 12;

type FlagStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function tipSeen(store: FlagStore | undefined = globalThis.localStorage): boolean {
  try {
    return store?.getItem(THREAT_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

function markTipSeen(store: FlagStore | undefined = globalThis.localStorage): void {
  try { store?.setItem(THREAT_TIP_KEY, '1'); } catch { /* storage unavailable */ }
}

/** One edge arrow's place this frame (screen px) and what it shows. */
type Arrow = { show: boolean; player: Player | null; x: number; y: number; angle: number; label: string; closest: boolean };

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

/**
 * `threats` is the session's per-frame list (closest first, empty with danger warnings off);
 * `faceOf` gives a rival's face for its arrow chip.
 */
export function createOverlay(danger: DangerState, threats: readonly Threat[] = [], faceOf?: (p: Player) => Face): Overlay {
  let time = 0;
  const arrows: Arrow[] = Array.from({ length: MAX_THREATS }, () =>
    ({ show: false, player: null, x: 0, y: 0, angle: 0, label: '', closest: false }));
  let anyArrow = false;
  let tipDone = tipSeen();
  /** Seconds the tooltip has left, and the rival whose arrow it sits beside. */
  let tipLeft = 0;
  let tipId = -1;
  let tipTextW = 0;
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
    update(world, cam, dt, alpha) {
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
      updateArrows(world, cam, alpha);
      if (tipLeft > 0) tipLeft = Math.max(0, tipLeft - dt);
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
      if (anyArrow) drawArrows(ctx, cam);
    },
  };

  /** Places an edge arrow for every threat whose head is off-screen. */
  function updateArrows(world: World, cam: Camera, alpha: number): void {
    const w = cam.viewW, h = cam.viewH, s = cam.scale();
    const margin = 0.6 * s; // half a head: an arrow only once the whole head is out of view
    const cx = w / 2, cy = h / 2;
    const hx = Math.max(1, cx - THREAT_EDGE_INSET - THREAT_CHIP_R);
    const hy = Math.max(1, cy - THREAT_EDGE_INSET - THREAT_CHIP_R);
    anyArrow = false;
    for (let i = 0; i < arrows.length; i++) {
      const a = arrows[i];
      a.show = false;
      if (i >= threats.length) continue;
      const t = threats[i];
      const p = world.players[t.id];
      if (!p || !p.alive) continue;
      const px = (p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha - cam.x) * s + cx;
      const py = (p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha - cam.y) * s + cy;
      if (px > -margin && px < w + margin && py > -margin && py < h + margin) continue;
      // Where the line from the screen centre to the rival crosses the inset edge.
      const dx = px - cx, dy = py - cy;
      const k = Math.min(dx !== 0 ? hx / Math.abs(dx) : Infinity, dy !== 0 ? hy / Math.abs(dy) : Infinity);
      a.show = true;
      a.player = p;
      a.x = cx + dx * k;
      a.y = cy + dy * k;
      a.angle = Math.atan2(dy, dx);
      a.label = DIST_LABELS[Math.min(DIST_LABELS.length - 1, Math.max(0, Math.round(t.dist)))];
      a.closest = !anyArrow; // the closest threat that has an arrow (threats are sorted)
      anyArrow = true;
      if (!tipDone) {
        tipDone = true;
        markTipSeen();
        tipLeft = THREAT_TIP_S;
        tipId = t.id;
      }
    }
  }

  /** The chip outline: a circle with a rounded tip toward +x. */
  function chipPath(ctx: CanvasRenderingContext2D): void {
    const r = THREAT_CHIP_R, spread = 0.62;
    ctx.beginPath();
    ctx.moveTo(THREAT_TIP, 0);
    ctx.lineTo(r * Math.cos(spread), r * Math.sin(spread));
    ctx.arc(0, 0, r, spread, Math.PI * 2 - spread);
    ctx.closePath();
  }

  function drawArrows(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const pulse = reduced ? 0 : 0.06 * Math.sin(time * THREAT_PULSE_HZ * Math.PI * 2);
    // Back to front, so the closest (index 0) ends up on top.
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      if (!a.show || !a.player) continue;
      const c = playerColors(a.player.colorIndex);
      const k = a.closest ? THREAT_CLOSEST_SCALE * (1 + pulse) : 1;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.scale(k, k);
      ctx.lineJoin = 'round';
      // Lip: the same shape 3 px lower, in the rival's lip colour.
      ctx.save();
      ctx.translate(0, LIP_PX);
      ctx.rotate(a.angle);
      chipPath(ctx);
      ctx.fillStyle = c.lip;
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.rotate(a.angle);
      chipPath(ctx);
      ctx.fillStyle = c.base;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      // Upright contents: the rival's face over its distance.
      const face = faceOf?.(a.player);
      if (face) {
        ctx.save();
        ctx.translate(0, -5);
        drawFace(ctx, face, THREAT_FACE_PX);
        ctx.restore();
      }
      ctx.font = THREAT_FONT;
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.label, 0, face ? 9 : 0);
      ctx.restore();
    }
    if (tipLeft > 0) drawTip(ctx, cam);
  }

  /** "Rival heading for your trail": a white pill with a lip, beside the first arrow. */
  function drawTip(ctx: CanvasRenderingContext2D, cam: Camera): void {
    let a: Arrow | null = null;
    for (const x of arrows) if (x.show && x.player?.id === tipId) a = x;
    if (!a) return;
    ctx.font = TIP_FONT;
    if (tipTextW === 0) tipTextW = ctx.measureText(THREAT_TIP_TEXT).width;
    const tw = tipTextW + TIP_PAD * 2;
    // Toward the screen centre from the arrow, clear of the (possibly scaled) chip.
    const reach = THREAT_CHIP_R * THREAT_CLOSEST_SCALE + 10;
    const ux = -Math.cos(a.angle), uy = -Math.sin(a.angle);
    const ccx = a.x + ux * (reach + tw / 2), ccy = a.y + uy * (reach + TIP_H / 2);
    const x = Math.max(EDGE_MARGIN, Math.min(cam.viewW - EDGE_MARGIN - tw, ccx - tw / 2));
    const y = Math.max(EDGE_MARGIN, Math.min(cam.viewH - EDGE_MARGIN - TIP_H - LIP_PX, ccy - TIP_H / 2));
    const shown = THREAT_TIP_S - tipLeft;
    const fade = Math.min(1, shown / 0.2, tipLeft / 0.3);
    ctx.save();
    ctx.globalAlpha = fade;
    pill(ctx, x, y + LIP_PX, tw, TIP_H);
    ctx.fillStyle = CHIP_LIP;
    ctx.fill();
    pill(ctx, x, y, tw, TIP_H);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(THREAT_TIP_TEXT, x + tw / 2, y + TIP_H / 2 + 1);
    ctx.restore();
  }

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
