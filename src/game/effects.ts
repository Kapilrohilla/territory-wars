import type { MultiPoly, Vec } from '../sim/geometry';
import type { Burn, GameEvent, World } from '../sim/types';
import type { Camera } from './camera';
import { LIP_OFFSET, landPath, playerColors, pointOnTrail, prefersReducedMotion } from './render';
import { PALETTE, playerShade } from './palette';
import { landArea } from '../sim/territory';
import { maxDistFrom, waveRadius, waveSeconds } from './waves';
import { vibrate } from '../native/platform';

// Captured land rises from under the board while brightening from the lip shade to the base.
const CAPTURE_S = 0.5;
const CAPTURE_RISE_S = 0.35;
const CAPTURE_DEPTH = 0.7;
const CAPTURE_APPEAR_S = 0.06;
// Capture wave (waves.ts): ripple rings trail the front by RING_GAP, fading over the wave.
const RING_GAP = 1.2;
const RING_COUNT = 3;
const RING_W = 0.25;
const RING_COLOR = 'rgba(255, 255, 255, 0.55)';
// Dead land darkens to its lip shade, then sinks and fades.
const DEATH_S = 0.35;
const DEATH_DARKEN_S = 0.22;
const DEATH_DEPTH = 0.9;
const TEXT_S = 1.2;
const TEXT_RISE = 2;
const TEXT_POP_S = 0.15;
/** Each newer popup pushes the live ones up by this much (px), sliding over ~STACK_SLIDE_S. */
const STACK_PX = 26;
const STACK_SLIDE_S = 0.05;
const NUDGE = 0.3;
const KILL_NUDGE = 0.55;
const VIBRATE_MS = 15;
const KILL_VIBRATE_MS = 30;

// Spawn: the head drops onto the board, squashes on landing, stretches, settles.
const SPAWN_DROP_S = 0.25;
const SPAWN_STEP_S = 0.1;
export const SPAWN_S = SPAWN_DROP_S + 3 * SPAWN_STEP_S;
export const SPAWN_HEIGHT = 4;
const SPAWN_KEYS: readonly [number, number][] = [[1, 1], [1.25, 0.75], [0.85, 1.2], [1, 1]];

// Chunks: coloured confetti for deaths (player colour) and re-entering home (lip colour).
const CHUNK_POOL = 160;
const DEATH_CHUNKS = 22;
const DEATH_CHUNK_SPEED = 13;
const DEATH_CHUNK_S = 0.8;
const ENTER_CHUNKS = 9;
const ENTER_CHUNK_SPEED = 6;
const ENTER_CHUNK_S = 0.45;
const CHUNK_DRAG = 4;

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

type Chunk = {
  x: number; y: number; vx: number; vy: number; rot: number; vr: number;
  size: number; color: string; t: number; life: number;
};

/**
 * Land rising into place; `fromColorIndex` is a victim's colour it flips from (taken land).
 * With a `wave`, it fills outward from (ox, oy) over waveS seconds to cover maxDist; without
 * one (a spawn's land) it fades in everywhere at once. `life` is how long it stays.
 */
type CaptureFx = {
  playerId: number; colorIndex: number; region: MultiPoly; t: number; fromColorIndex?: number;
  wave: boolean; ox: number; oy: number; waveS: number; maxDist: number; life: number;
};

/** A capture fading in; with `origin`, as a wave spreading from it (see waves.ts). */
function captureFx(playerId: number, colorIndex: number, region: MultiPoly, origin: Vec | null,
  fromColorIndex?: number): CaptureFx {
  const waveS = origin ? waveSeconds(landArea(region)) : 0;
  return {
    playerId, colorIndex, region, t: 0, fromColorIndex,
    wave: origin !== null, ox: origin?.x ?? 0, oy: origin?.y ?? 0, waveS,
    maxDist: origin ? maxDistFrom(region, origin) : 0,
    life: Math.max(CAPTURE_S, waveS),
  };
}
type TextFx = { text: string; colorIndex: number; at: Vec; t: number; size: number; stack: number; shown: number };
type DyingFx = { colorIndex: number; land: MultiPoly; t: number };

/** A head's spawn pose: lifted `lift` world units above its spot, scaled (sx, sy) about its base. */
export type HeadPose = { lift: number; sx: number; sy: number; alpha: number };

export type Effects = {
  onEvents(events: GameEvent[], world: World, cam: Pick<Camera, 'nudge'>): void;
  /**
   * Watches for rival trails the human has just set burning (a spark burst at the hit).
   * Backs up the `cut` event (each burn sparks once either way).
   */
  observe(world: World): void;
  update(dt: number): void;
  /** The spawn pose of a head still dropping in or settling, else null. */
  headPose(playerId: number): HeadPose | null;
  /** Regions still fading in, to be cut out of the owner's land this frame. */
  landMask(playerId: number): MultiPoly[] | undefined;
  /** World-space layer (capture fade-ins, death shrink); call inside the camera transform. */
  drawWorld(ctx: CanvasRenderingContext2D): void;
  /** World-space layer above trails and heads (cut sparks, death and home-coming chunks); call inside the camera transform. */
  drawWorldTop(ctx: CanvasRenderingContext2D): void;
  /** Screen-space layer (floating "+x.x%" and kill callouts, stacked); call with ctx in CSS pixels. */
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

/** Kill callout for the human's n-th kill of the round; it escalates up to a streak. */
export function killText(n: number): string {
  if (n <= 1) return 'Takedown!';
  if (n === 2) return 'Double takedown!';
  if (n === 3) return 'Triple takedown!';
  return `Unstoppable ×${n}!`;
}

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
/** Overshoots past 1 then settles (a springy pop). */
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Spawn pose t seconds after a head appears; null once settled (t >= SPAWN_S). */
export function spawnPose(t: number): HeadPose | null {
  if (t >= SPAWN_S || t < 0) return null;
  if (t < SPAWN_DROP_S) {
    const u = t / SPAWN_DROP_S;
    // Falls (accelerating) and looks bigger while nearer the camera.
    const k = 1 + 0.35 * (1 - u);
    return { lift: SPAWN_HEIGHT * (1 - u * u), sx: k, sy: k, alpha: Math.min(1, u * 3) };
  }
  const st = (t - SPAWN_DROP_S) / SPAWN_STEP_S;
  const i = Math.min(2, Math.floor(st));
  const u = easeOutQuad(Math.min(1, st - i));
  const [ax, ay] = SPAWN_KEYS[i], [bx, by] = SPAWN_KEYS[i + 1];
  return { lift: 0, sx: ax + (bx - ax) * u, sy: ay + (by - ay) * u, alpha: 1 };
}

/** Chunk opacity over its life u (0..1): full, half by mid-life, gone at the end. */
export function chunkAlpha(u: number): number {
  return 1 - clamp01(u);
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

/** Land drawn `dy` below its place with the given top colour; the lip shows `lip` of its depth. */
function fillShape(ctx: CanvasRenderingContext2D, m: MultiPoly, colorIndex: number, top: string,
  dy: number, lip: number, alpha: number): void {
  const path = landPath(m);
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(0, dy);
  if (lip > 0) {
    ctx.save();
    ctx.translate(0, LIP_OFFSET * lip);
    ctx.fillStyle = playerColors(colorIndex).lip;
    ctx.fill(path, 'evenodd');
    ctx.restore();
  }
  ctx.fillStyle = top;
  ctx.fill(path, 'evenodd');
  ctx.restore();
}

/**
 * A capture mid-wave: unreached land shows what was there (pale arena, or the victim's land
 * for an absorb); inside the front's circle it is the owner's, rising with the usual lip.
 * Ripple rings ride just behind the front, clipped to the region.
 */
function drawWave(ctx: CanvasRenderingContext2D, c: CaptureFx, rise: number, bright: number): void {
  const r = waveRadius(c.t, c.waveS, c.maxDist);
  const done = c.t >= c.waveS;
  if (!done) {
    if (c.fromColorIndex !== undefined) {
      fillShape(ctx, c.region, c.fromColorIndex, playerColors(c.fromColorIndex).base, 0, 1, 1);
    } else {
      ctx.globalAlpha = 1;
      ctx.fillStyle = PALETTE.arena;
      ctx.fill(landPath(c.region), 'evenodd');
    }
  }
  ctx.save();
  if (!done) {
    ctx.beginPath();
    ctx.arc(c.ox, c.oy, Math.max(0, r), 0, Math.PI * 2);
    ctx.clip();
  }
  fillShape(ctx, c.region, c.colorIndex, playerShade(c.colorIndex, bright), CAPTURE_DEPTH * (1 - rise), rise,
    clamp01(c.t / CAPTURE_APPEAR_S));
  ctx.restore();
  if (done) return;
  ctx.save();
  ctx.clip(landPath(c.region), 'evenodd');
  ctx.globalAlpha = 1 - clamp01(c.t / c.waveS);
  ctx.strokeStyle = RING_COLOR;
  ctx.lineWidth = RING_W;
  for (let i = 0; i < RING_COUNT; i++) {
    const ri = r - i * RING_GAP;
    if (ri <= RING_W) break;
    ctx.beginPath();
    ctx.arc(c.ox, c.oy, ri, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function createEffects(): Effects {
  let captures: CaptureFx[] = [];
  let texts: TextFx[] = [];
  let dying: DyingFx[] = [];
  const sparks: Spark[] = Array.from({ length: SPARK_POOL }, () => ({ x: 0, y: 0, vx: 0, vy: 0, t: 1, life: 0 }));
  const flashes: Flash[] = Array.from({ length: FLASH_POOL }, () => ({ x: 0, y: 0, t: FLASH_S }));
  const burst = Array.from({ length: Math.max(SPARK_COUNT, DEATH_CHUNKS) }, () => ({ vx: 0, vy: 0 }));
  const chunks: Chunk[] = Array.from({ length: CHUNK_POOL }, () => ({
    x: 0, y: 0, vx: 0, vy: 0, rot: 0, vr: 0, size: 0, color: '', t: 1, life: 0,
  }));
  let liveSparks = 0;
  let liveFlashes = 0;
  let liveChunks = 0;
  /** Seconds since each player's head appeared (spawn, respawn, revive); undefined once settled. */
  const spawnT: (number | undefined)[] = [];
  let livePops = 0;
  /** The `deaths` count of the life each player's spawn pop was played for (-1: none yet). */
  const popLife: number[] = [];
  /** The human's `deaths` count already burst for, so a down then a give-up bursts once. */
  let humanBurst = -1;

  const spawnChunks = (at: Vec, n: number, speed: number, life: number, size: number, color: string) => {
    sparkVelocities(n, speed, Math.random, burst);
    let k = 0;
    for (const c of chunks) {
      if (k >= n) break;
      if (c.t < c.life) continue;
      c.x = at.x; c.y = at.y; c.vx = burst[k].vx; c.vy = burst[k].vy;
      c.rot = Math.random() * Math.PI; c.vr = (Math.random() - 0.5) * 14;
      c.size = size * (0.6 + 0.6 * Math.random()); c.color = color;
      c.t = 0; c.life = life * (0.7 + 0.3 * Math.random());
      k++;
    }
    liveChunks += k;
  };

  /** Pushes a popup; the live ones step up to make room. */
  const pushText = (text: string, colorIndex: number, at: Vec, size: number) => {
    for (const t of texts) t.stack += STACK_PX;
    texts.push({ text, colorIndex, at: { x: at.x, y: at.y }, t: 0, size, stack: 0, shown: 0 });
  };

  const burstDeath = (world: World, id: number) => {
    const p = world.players[id];
    if (p.isHuman) {
      if (humanBurst === p.deaths) return;
      humanBurst = p.deaths;
    }
    const c = playerColors(p.colorIndex);
    spawnChunks(p.pos, DEATH_CHUNKS, DEATH_CHUNK_SPEED, DEATH_CHUNK_S, 0.55, c.base);
    spawnChunks(p.pos, Math.round(DEATH_CHUNKS / 2), DEATH_CHUNK_SPEED * 0.6, DEATH_CHUNK_S, 0.45, c.lip);
  };
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
        if (e.type === 'cut') {
          checkBurn(world, e.victimId);
          continue;
        }
        if (e.type === 'capture') {
          const p = world.players[e.playerId];
          if (e.region.length > 0) {
            // The loop closed where the head is now: the wave starts there.
            captures.push(captureFx(p.id, p.colorIndex, e.region, p.pos));
            spawnChunks(p.pos, ENTER_CHUNKS, ENTER_CHUNK_SPEED, ENTER_CHUNK_S, 0.35, playerColors(p.colorIndex).lip);
          }
          if (p.isHuman && e.gainedPct > 0) {
            pushText(formatGain(e.gainedPct), p.colorIndex, p.pos, 22);
            cam.nudge(NUDGE);
            vibrate(VIBRATE_MS);
          }
        } else if (e.type === 'absorb') {
          // The victim's land flips to the killer's colour instead of sinking away.
          const p = world.players[e.playerId];
          const v = world.players[e.victimId];
          captures.push(captureFx(p.id, p.colorIndex, e.region, p.pos, v.colorIndex));
          if (p.isHuman && e.gainedPct > 0) pushText(formatGain(e.gainedPct), p.colorIndex, p.pos, 22);
        } else if (e.type === 'death' || e.type === 'down') {
          const p = world.players[e.playerId];
          burstDeath(world, p.id);
          const human = world.players[world.humanId];
          if (e.killerId === human.id && p.id !== human.id) {
            pushText(killText(human.kills), p.colorIndex, human.pos, 28);
            cam.nudge(KILL_NUDGE);
            vibrate(KILL_VIBRATE_MS);
          }
          // A down may be revived with its land intact: it only sinks on the final death.
          if (e.type === 'down') continue;
          const land = p.dyingLand && p.dyingLand.length ? p.dyingLand : p.land;
          if (land.length) dying.push({ colorIndex: p.colorIndex, land, t: 0 });
          // The owner's land is gone; any fade-in still pending for it is moot.
          captures = captures.filter((c) => c.playerId !== p.id);
        }
      }
    },

    observe(world) {
      for (const p of world.players) {
        if (p.burn !== (seenBurn[p.id] ?? null)) checkBurn(world, p.id);
        if (p.alive && (popLife[p.id] ?? -1) !== p.deaths) {
          // A new life (first spawn, respawn or revive): drop the head in, raise its land.
          popLife[p.id] = p.deaths;
          if (spawnT[p.id] === undefined) livePops++;
          spawnT[p.id] = 0;
          if (p.land.length) {
            captures = captures.filter((c) => c.playerId !== p.id);
            captures.push(captureFx(p.id, p.colorIndex, p.land, null));
          }
        }
      }
    },

    headPose(playerId) {
      const t = spawnT[playerId];
      return t === undefined ? null : spawnPose(t);
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
      if (liveChunks) {
        const drag = Math.exp(-CHUNK_DRAG * dt);
        liveChunks = 0;
        for (const c of chunks) {
          if (c.t >= c.life) continue;
          c.t += dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.vx *= drag;
          c.vy *= drag;
          c.rot += c.vr * dt;
          if (c.t < c.life) liveChunks++;
        }
      }
      if (livePops) {
        livePops = 0;
        for (let i = 0; i < spawnT.length; i++) {
          const t = spawnT[i];
          if (t === undefined) continue;
          if (t + dt >= SPAWN_S) spawnT[i] = undefined;
          else { spawnT[i] = t + dt; livePops++; }
        }
      }
      if (captures.length) {
        for (const c of captures) c.t += dt;
        captures = captures.filter((c) => c.t < c.life);
      }
      if (texts.length) {
        const k = 1 - Math.exp(-dt / STACK_SLIDE_S);
        for (const t of texts) {
          t.t += dt;
          t.shown += (t.stack - t.shown) * k;
        }
        texts = texts.filter((t) => t.t < TEXT_S);
      }
      if (dying.length) {
        for (const d of dying) d.t += dt;
        dying = dying.filter((d) => d.t < DEATH_S);
      }
    },

    landMask(playerId) {
      let out: MultiPoly[] | undefined;
      for (const c of captures) if (c.playerId === playerId) (out ??= []).push(c.region);
      return out;
    },

    drawWorld(ctx) {
      for (const d of dying) {
        const u = clamp01(d.t / DEATH_S);
        const dark = clamp01(d.t / DEATH_DARKEN_S);
        const sink = easeInQuad(u);
        fillShape(ctx, d.land, d.colorIndex, playerShade(d.colorIndex, 1 - dark), DEATH_DEPTH * sink, 1 - sink,
          1 - sink);
      }
      const reduced = captures.length > 0 && prefersReducedMotion();
      for (const c of captures) {
        const rise = easeOutQuad(clamp01(c.t / CAPTURE_RISE_S));
        const bright = easeOutCubic(clamp01(c.t / CAPTURE_S));
        if (c.wave && !reduced) {
          drawWave(ctx, c, rise, bright);
          continue;
        }
        if (c.fromColorIndex !== undefined) {
          const from = playerColors(c.fromColorIndex);
          fillShape(ctx, c.region, c.fromColorIndex, from.base, 0, 1, 1 - bright);
        }
        fillShape(ctx, c.region, c.colorIndex, playerShade(c.colorIndex, bright), CAPTURE_DEPTH * (1 - rise), rise,
          clamp01(c.t / CAPTURE_APPEAR_S));
      }
      ctx.globalAlpha = 1;
    },

    drawWorldTop(ctx) {
      if (liveChunks) {
        for (const c of chunks) {
          if (c.t >= c.life) continue;
          const u = c.t / c.life;
          ctx.globalAlpha = chunkAlpha(u);
          ctx.fillStyle = c.color;
          const h = c.size * (1 - 0.4 * u) / 2;
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.rot);
          ctx.fillRect(-h, -h, h * 2, h * 2);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
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
        const pop = 0.5 + 0.5 * easeOutBack(clamp01(t.t / TEXT_POP_S));
        const alpha = u < 0.6 ? 1 : 1 - easeInQuad((u - 0.6) / 0.4);
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${Math.round(t.size * pop)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        const y = sp.y - t.shown;
        ctx.strokeText(t.text, sp.x, y);
        ctx.fillStyle = playerColors(t.colorIndex).lip;
        ctx.fillText(t.text, sp.x, y);
      }
      ctx.restore();
    },

    busy() {
      return captures.length > 0 || texts.length > 0 || dying.length > 0 || liveSparks > 0 || liveFlashes > 0
        || liveChunks > 0 || livePops > 0;
    },
  };
}
