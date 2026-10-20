import { CONFIG } from '../sim/config';
import type { MultiPoly, Vec } from '../sim/geometry';
import type { Burn, GameEvent, World } from '../sim/types';
import type { Camera } from './camera';
import { LIP_OFFSET, landPath, playerColors, pointOnTrail } from './render';
import { playPop } from './sound';

const CAPTURE_S = 0.2;
const CAPTURE_SCALE0 = 1.04;
const TEXT_S = 0.9;
const TEXT_RISE = 2;
const TEXT_POP_S = 0.12;
const NUDGE = 0.3;
const VIBRATE_MS = 15;
const DYING_ALPHA0 = 0.85;

const SPARK_S = 0.45;
const SPARK_COUNT = 14;
const SPARK_POOL = 56;
const SPARK_SPEED = 15;
const SPARK_DRAG = 5;
const SPARK_LEN_S = 0.045;
const FLASH_S = 0.18;
const FLASH_POOL = 4;
const FLASH_R = 1.1;

/** Pooled spark particle; `t >= life` means free. */
type Spark = { x: number; y: number; vx: number; vy: number; t: number; life: number };
type Flash = { x: number; y: number; t: number };

type CaptureFx = { playerId: number; colorIndex: number; region: MultiPoly; c: Vec; t: number };
type TextFx = { text: string; colorIndex: number; at: Vec; t: number };
type DyingFx = { colorIndex: number; land: MultiPoly; c: Vec; t: number };

export type Effects = {
  onEvents(events: GameEvent[], world: World, cam: Pick<Camera, 'nudge'>): void;
  /**
   * Watches for rival trails the human has just set burning (a spark burst at the hit).
   * The `cut` event does the same where the sim emits it; each burn sparks once either way.
   */
  observe(world: World): void;
  update(dt: number): void;
  /** Regions still fading in, to be cut out of the owner's land this frame. */
  landMask(playerId: number): MultiPoly[] | undefined;
  /** World-space layer (capture fade-ins, death shrink); call inside the camera transform. */
  drawWorld(ctx: CanvasRenderingContext2D): void;
  /** World-space layer above trails and heads (cut sparks); call inside the camera transform. */
  drawWorldTop(ctx: CanvasRenderingContext2D): void;
  /** Screen-space layer (floating "+x.x%"); call with ctx in CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera): void;
  /** True while any effect is still animating. */
  busy(): boolean;
};

/** Spark velocities for a burst: n evenly spread directions with jitter from rnd (0..1). */
export function sparkVelocities(n: number, speed: number, rnd: () => number, out: { vx: number; vy: number }[]): void {
  for (let i = 0; i < n; i++) {
    const a = ((i + rnd() * 0.8) / n) * Math.PI * 2;
    const v = speed * (0.55 + 0.45 * rnd());
    out[i].vx = Math.cos(a) * v;
    out[i].vy = Math.sin(a) * v;
  }
}

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
  const sparks: Spark[] = Array.from({ length: SPARK_POOL }, () => ({ x: 0, y: 0, vx: 0, vy: 0, t: 1, life: 0 }));
  const flashes: Flash[] = Array.from({ length: FLASH_POOL }, () => ({ x: 0, y: 0, t: FLASH_S }));
  const burst = Array.from({ length: SPARK_COUNT }, () => ({ vx: 0, vy: 0 }));
  let liveSparks = 0;
  let liveFlashes = 0;
  /** The burn each player had when last seen, so a burn sparks once. */
  const seenBurn: (Burn | null)[] = [];

  const spawnBurst = (at: Vec) => {
    sparkVelocities(SPARK_COUNT, SPARK_SPEED, Math.random, burst);
    let k = 0;
    for (const s of sparks) {
      if (k >= SPARK_COUNT) break;
      if (s.t < s.life) continue;
      s.x = at.x; s.y = at.y; s.vx = burst[k].vx; s.vy = burst[k].vy;
      s.t = 0; s.life = SPARK_S * (0.6 + 0.4 * Math.random());
      k++;
    }
    liveSparks += k;
    for (const f of flashes) {
      if (f.t < FLASH_S) continue;
      f.x = at.x; f.y = at.y; f.t = 0;
      liveFlashes++;
      break;
    }
  };

  /** Sparks once per new burn the human started on a rival's trail. */
  const checkBurn = (world: World, victimId: number) => {
    const v = world.players[victimId];
    if (!v) return;
    const b = v.burn;
    if (b === (seenBurn[victimId] ?? null)) return;
    seenBurn[victimId] = b;
    if (!b || v.isHuman || b.killerId !== world.humanId || !v.alive) return;
    spawnBurst(pointOnTrail(v.trail, v.pos, b.s0));
  };

  return {
    onEvents(events, world, cam) {
      for (const e of events) {
        // `cut` (a rival's trail set burning) only exists in newer sims; typed loosely so this
        // compiles either way.
        const ev = e as { type: string; victimId?: number };
        if (ev.type === 'cut' && typeof ev.victimId === 'number') {
          checkBurn(world, ev.victimId);
          continue;
        }
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

    observe(world) {
      for (const p of world.players) {
        if (p.burn !== (seenBurn[p.id] ?? null)) checkBurn(world, p.id);
      }
    },

    update(dt) {
      if (liveSparks) {
        const drag = Math.exp(-SPARK_DRAG * dt);
        liveSparks = 0;
        for (const s of sparks) {
          if (s.t >= s.life) continue;
          s.t += dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.vx *= drag;
          s.vy *= drag;
          if (s.t < s.life) liveSparks++;
        }
      }
      if (liveFlashes) {
        liveFlashes = 0;
        for (const f of flashes) {
          if (f.t >= FLASH_S) continue;
          f.t += dt;
          if (f.t < FLASH_S) liveFlashes++;
        }
      }
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

    drawWorldTop(ctx) {
      if (!liveSparks && !liveFlashes) return;
      if (liveFlashes) {
        ctx.fillStyle = '#FFB347';
        for (const f of flashes) {
          if (f.t >= FLASH_S) continue;
          const u = f.t / FLASH_S;
          ctx.globalAlpha = 0.45 * (1 - u);
          ctx.beginPath();
          ctx.arc(f.x, f.y, FLASH_R * (0.4 + 0.6 * easeOutCubic(u)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (liveSparks) {
        ctx.lineCap = 'round';
        for (const s of sparks) {
          if (s.t >= s.life) continue;
          const u = s.t / s.life;
          ctx.globalAlpha = 1 - u * u;
          ctx.strokeStyle = u < 0.35 ? '#FFB347' : '#FF7A59';
          ctx.lineWidth = 0.2 * (1 - 0.5 * u);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - s.vx * SPARK_LEN_S, s.y - s.vy * SPARK_LEN_S);
          ctx.stroke();
        }
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
      return captures.length > 0 || texts.length > 0 || dying.length > 0 || liveSparks > 0 || liveFlashes > 0;
    },
  };
}
