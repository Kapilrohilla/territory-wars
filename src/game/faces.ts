import type { Face } from './skins';

/**
 * Draws faces from Face data. Everything is relative to the head size `u`, centred on
 * the current origin, so the same face works on a 1.2-unit head in the arena and on a
 * 64px skin preview. `look` (a unit vector) nudges pupils toward the heading.
 */

const INK = '#34323f';
const WHITE = '#ffffff';
const BLUSH = 'rgba(255, 120, 140, 0.45)';
const SWEAT = '#6cc3ef';
const GOLD = '#ffc93c';
const GOLD_LIP = '#d9a21a';

export type FaceColors = { base: string; lip: string };
export type Look = { x: number; y: number };

const EYE_X = 0.2;
const EYE_Y = -0.06;
const MOUTH_Y = 0.2;

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function stroke(ctx: CanvasRenderingContext2D, w: number, color = INK): void {
  ctx.lineWidth = w;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.lineWidth = r * 0.25;
  ctx.strokeStyle = GOLD_LIP;
  ctx.stroke();
}

function eyes(ctx: CanvasRenderingContext2D, f: Face, u: number, look: Look): void {
  const ex = EYE_X * u, ey = EYE_Y * u;
  const lx = look.x * 0.05 * u, ly = look.y * 0.05 * u;
  for (const side of [-1, 1]) {
    const x = side * ex;
    switch (f.eyes) {
      case 'dot':
        dot(ctx, x + lx * 0.5, ey + ly * 0.5, 0.075 * u, INK);
        break;
      case 'round':
        dot(ctx, x, ey, 0.13 * u, WHITE);
        dot(ctx, x + lx, ey + ly, 0.07 * u, INK);
        dot(ctx, x + lx - 0.025 * u, ey + ly - 0.025 * u, 0.022 * u, WHITE);
        break;
      case 'wide':
        dot(ctx, x, ey, 0.14 * u, WHITE);
        dot(ctx, x + lx * 0.6, ey + ly * 0.6, 0.04 * u, INK);
        break;
      case 'sleepy':
        ctx.beginPath();
        ctx.arc(x, ey - 0.02 * u, 0.08 * u, 0.15 * Math.PI, 0.85 * Math.PI);
        stroke(ctx, 0.05 * u);
        break;
      case 'happy':
        ctx.beginPath();
        ctx.arc(x, ey + 0.04 * u, 0.08 * u, 1.15 * Math.PI, 1.85 * Math.PI);
        stroke(ctx, 0.055 * u);
        break;
      case 'x': {
        const r = 0.065 * u;
        ctx.beginPath();
        ctx.moveTo(x - r, ey - r); ctx.lineTo(x + r, ey + r);
        ctx.moveTo(x + r, ey - r); ctx.lineTo(x - r, ey + r);
        stroke(ctx, 0.05 * u);
        break;
      }
      case 'star':
        star(ctx, x, ey, 0.12 * u);
        break;
      case 'square':
        ctx.fillStyle = INK;
        ctx.fillRect(x - 0.08 * u, ey - 0.08 * u, 0.16 * u, 0.16 * u);
        ctx.fillStyle = '#7fe7ff';
        ctx.fillRect(x - 0.045 * u + lx * 0.4, ey - 0.045 * u + ly * 0.4, 0.07 * u, 0.07 * u);
        break;
      case 'shades':
      case 'cyclops':
        break; // drawn once below, not per eye
    }
  }
  if (f.eyes === 'shades') {
    ctx.fillStyle = INK;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * ex, ey, 0.14 * u, 0.1 * u, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-ex + 0.12 * u, ey - 0.03 * u);
    ctx.lineTo(ex - 0.12 * u, ey - 0.03 * u);
    stroke(ctx, 0.04 * u);
    dot(ctx, -ex - 0.05 * u, ey - 0.035 * u, 0.025 * u, 'rgba(255,255,255,0.7)');
    dot(ctx, ex - 0.05 * u, ey - 0.035 * u, 0.025 * u, 'rgba(255,255,255,0.7)');
  } else if (f.eyes === 'cyclops') {
    dot(ctx, 0, ey, 0.2 * u, WHITE);
    dot(ctx, lx * 1.4, ey + ly * 1.4, 0.1 * u, INK);
    dot(ctx, lx * 1.4 - 0.035 * u, ey + ly * 1.4 - 0.035 * u, 0.03 * u, WHITE);
  }
}

function brows(ctx: CanvasRenderingContext2D, f: Face, u: number): void {
  if (f.brows === 'none' || f.eyes === 'cyclops' || f.eyes === 'shades') return;
  const ex = EYE_X * u, by = (EYE_Y - 0.17) * u;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const inner = f.brows === 'angry' ? 0.05 * u : -0.04 * u;
    ctx.moveTo(side * (ex + 0.1 * u), by - (f.brows === 'angry' ? 0.03 * u : -0.02 * u));
    ctx.lineTo(side * (ex - 0.08 * u), by + inner);
  }
  stroke(ctx, 0.05 * u);
}

function mouth(ctx: CanvasRenderingContext2D, f: Face, u: number): void {
  const y = MOUTH_Y * u;
  ctx.beginPath();
  switch (f.mouth) {
    case 'none':
      return;
    case 'smile':
      ctx.arc(0, y - 0.06 * u, 0.09 * u, 0.2 * Math.PI, 0.8 * Math.PI);
      stroke(ctx, 0.045 * u);
      return;
    case 'grin':
      ctx.moveTo(-0.12 * u, y - 0.03 * u);
      ctx.quadraticCurveTo(0, y + 0.16 * u, 0.12 * u, y - 0.03 * u);
      ctx.closePath();
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.07 * u, y + 0.06 * u);
      ctx.quadraticCurveTo(0, y + 0.02 * u, 0.07 * u, y + 0.06 * u);
      ctx.quadraticCurveTo(0, y + 0.09 * u, -0.07 * u, y + 0.06 * u);
      ctx.fillStyle = '#ff8fa3';
      ctx.fill();
      return;
    case 'flat':
      ctx.moveTo(-0.08 * u, y);
      ctx.lineTo(0.08 * u, y);
      stroke(ctx, 0.045 * u);
      return;
    case 'o':
      ctx.ellipse(0, y + 0.01 * u, 0.045 * u, 0.06 * u, 0, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      return;
    case 'frown':
      ctx.arc(0, y + 0.08 * u, 0.08 * u, 1.2 * Math.PI, 1.8 * Math.PI);
      stroke(ctx, 0.045 * u);
      return;
    case 'fang':
      ctx.moveTo(-0.11 * u, y - 0.02 * u);
      ctx.quadraticCurveTo(0, y + 0.07 * u, 0.11 * u, y - 0.02 * u);
      stroke(ctx, 0.045 * u);
      ctx.beginPath();
      ctx.moveTo(-0.06 * u, y + 0.015 * u);
      ctx.lineTo(-0.035 * u, y + 0.08 * u);
      ctx.lineTo(-0.01 * u, y + 0.025 * u);
      ctx.moveTo(0.06 * u, y + 0.015 * u);
      ctx.lineTo(0.035 * u, y + 0.08 * u);
      ctx.lineTo(0.01 * u, y + 0.025 * u);
      ctx.fillStyle = WHITE;
      ctx.fill();
      return;
    case 'cat':
      ctx.moveTo(-0.09 * u, y - 0.01 * u);
      ctx.quadraticCurveTo(-0.045 * u, y + 0.06 * u, 0, y - 0.01 * u);
      ctx.quadraticCurveTo(0.045 * u, y + 0.06 * u, 0.09 * u, y - 0.01 * u);
      stroke(ctx, 0.04 * u);
      dot(ctx, 0, y - 0.05 * u, 0.03 * u, '#ff8fa3');
      return;
    case 'wobble':
      ctx.moveTo(-0.1 * u, y + 0.02 * u);
      for (let i = 1; i <= 4; i++) ctx.lineTo(-0.1 * u + i * 0.05 * u, y + (i % 2 ? -0.02 : 0.02) * u);
      stroke(ctx, 0.04 * u);
      return;
  }
}

/** Parts drawn behind the head (ears, horns, antenna): call before the head is filled. */
export function drawFaceBack(ctx: CanvasRenderingContext2D, f: Face, u: number, c: FaceColors): void {
  const h = u / 2;
  for (const x of f.extras) {
    if (x === 'ears') {
      ctx.fillStyle = c.lip;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.42 * u, -h + 0.12 * u);
        ctx.lineTo(side * 0.36 * u, -h - 0.2 * u);
        ctx.lineTo(side * 0.1 * u, -h + 0.02 * u);
        ctx.closePath();
        ctx.fill();
      }
    } else if (x === 'horns') {
      ctx.fillStyle = '#b4232f';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.36 * u, -h + 0.08 * u);
        ctx.quadraticCurveTo(side * 0.44 * u, -h - 0.12 * u, side * 0.3 * u, -h - 0.22 * u);
        ctx.lineTo(side * 0.16 * u, -h + 0.04 * u);
        ctx.closePath();
        ctx.fill();
      }
    } else if (x === 'antenna') {
      ctx.beginPath();
      ctx.moveTo(0, -h + 0.02 * u);
      ctx.lineTo(0, -h - 0.2 * u);
      stroke(ctx, 0.05 * u, c.lip);
      dot(ctx, 0, -h - 0.22 * u, 0.07 * u, '#ff7a59');
    }
  }
}

/** Eyes, brows, mouth and front extras, over an already-filled head of size `u`. */
export function drawFace(ctx: CanvasRenderingContext2D, f: Face, u: number, look: Look = { x: 0, y: 0 }): void {
  const h = u / 2;
  if (f.extras.includes('blush')) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 0.3 * u, 0.12 * u, 0.08 * u, 0.045 * u, 0, 0, Math.PI * 2);
      ctx.fillStyle = BLUSH;
      ctx.fill();
    }
  }
  eyes(ctx, f, u, look);
  brows(ctx, f, u);
  mouth(ctx, f, u);
  for (const x of f.extras) {
    if (x === 'whiskers') {
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(side * 0.2 * u, 0.17 * u); ctx.lineTo(side * 0.44 * u, 0.13 * u);
        ctx.moveTo(side * 0.2 * u, 0.22 * u); ctx.lineTo(side * 0.44 * u, 0.25 * u);
      }
      stroke(ctx, 0.025 * u);
    } else if (x === 'sweat') {
      ctx.beginPath();
      ctx.moveTo(0.36 * u, -0.3 * u);
      ctx.quadraticCurveTo(0.46 * u, -0.12 * u, 0.36 * u, -0.1 * u);
      ctx.quadraticCurveTo(0.26 * u, -0.12 * u, 0.36 * u, -0.3 * u);
      ctx.fillStyle = SWEAT;
      ctx.fill();
    } else if (x === 'tear') {
      dot(ctx, -EYE_X * u - 0.02 * u, (EYE_Y + 0.16) * u, 0.035 * u, SWEAT);
    } else if (x === 'crown') {
      ctx.beginPath();
      ctx.moveTo(-0.24 * u, -h + 0.04 * u);
      ctx.lineTo(-0.26 * u, -h - 0.2 * u);
      ctx.lineTo(-0.12 * u, -h - 0.08 * u);
      ctx.lineTo(0, -h - 0.24 * u);
      ctx.lineTo(0.12 * u, -h - 0.08 * u);
      ctx.lineTo(0.26 * u, -h - 0.2 * u);
      ctx.lineTo(0.24 * u, -h + 0.04 * u);
      ctx.closePath();
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.lineWidth = 0.035 * u;
      ctx.strokeStyle = GOLD_LIP;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
}
