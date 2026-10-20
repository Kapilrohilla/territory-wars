import { CONFIG, DIFFICULTY, type Difficulty } from './config';
import {
  type MultiPoly, type Vec,
  angleDiff, circleRing, clampToCircle, distPointSeg, segIntersect,
} from './geometry';
import { captureLand, keepPiece, landArea, landContains, subtractLand } from './territory';
import { mulberryNext } from './rng';
import { NAMES } from './names';
import type { GameEvent, Input, Player, World } from './types';

export type { GameEvent, Input, Player, World } from './types';

/** Number of player colours available (matches the 13-entry palette). */
export const COLOR_COUNT = 13;
const ARENA_AREA = Math.PI * CONFIG.ARENA_R * CONFIG.ARENA_R;
const SPAWN_TRIES = 40;
const SPAWN_CLEARANCE = 1.5;
const MOVE_R = CONFIG.ARENA_R - CONFIG.WALL_PAD;
const ARENA_POLY: MultiPoly = [[circleRing({ x: 0, y: 0 }, CONFIG.ARENA_R, CONFIG.ARENA_VERTS)]];
/** Trails that come this close to the wall may stick out of the arena once thickened. */
const CLIP_NEAR_R = CONFIG.ARENA_R - 1;

/** A random source that reads and advances world.rngState (keeps World serializable). */
function worldRng(world: World): () => number {
  return () => {
    const r = mulberryNext(world.rngState);
    world.rngState = r.state;
    return r.value;
  };
}

const startLand = (c: Vec): MultiPoly => [[circleRing(c, CONFIG.START_R, CONFIG.START_VERTS)]];
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (a: number) => angleDiff(a, 0);

function pickName(world: World, rng: () => number, avoid?: string): string {
  const used = new Set(world.players.filter((p) => p.alive).map((p) => p.name));
  if (avoid) used.add(avoid);
  const free = NAMES.filter((n) => !used.has(n));
  const pool = free.length > 0 ? free : NAMES;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

function multiPolyNear(m: MultiPoly | null, c: Vec, r: number): boolean {
  if (!m) return false;
  for (const poly of m) for (const ring of poly) for (const v of ring) if (dist(v, c) < r) return true;
  return false;
}

function spotIsClear(world: World, p: Player, c: Vec): boolean {
  const human = world.players[world.humanId];
  if (p.id !== human.id && dist(c, human.pos) < CONFIG.SPAWN_MIN_DIST) return false;
  const ring = circleRing(c, CONFIG.START_R + SPAWN_CLEARANCE, 12);
  const reach = CONFIG.START_R + SPAWN_CLEARANCE;
  for (const q of world.players) {
    if (q === p) continue;
    for (const land of [q.alive ? q.land : null, q.dyingLand]) {
      if (!land || land.length === 0) continue;
      if (landContains(land, c) || ring.some((v) => landContains(land, v))) return false;
      if (multiPolyNear(land, c, reach)) return false;
    }
    if (!q.alive) continue;
    if (dist(q.pos, c) < reach + 1) return false;
    const t = q.trail;
    for (let i = 0; i < t.length; i++) {
      const b = i + 1 < t.length ? t[i + 1] : q.pos;
      if (distPointSeg(c, t[i], b) < reach) return false;
    }
  }
  return true;
}

/** Places p at a random valid spot with fresh start land. Returns false if none was found. */
export function spawnPlayer(world: World, p: Player, rng: () => number): boolean {
  const maxR = CONFIG.ARENA_R - CONFIG.START_R - 2;
  for (let i = 0; i < SPAWN_TRIES; i++) {
    const r = maxR * Math.sqrt(rng());
    const a = rng() * Math.PI * 2;
    const c = { x: r * Math.cos(a), y: r * Math.sin(a) };
    if (!spotIsClear(world, p, c)) continue;
    const heading = wrap(rng() * Math.PI * 2);
    p.alive = true;
    p.pos = c;
    p.prevPos = { ...c };
    p.heading = heading;
    p.targetHeading = heading;
    p.land = startLand(c);
    p.trail = [];
    p.burn = null;
    p.deathTime = null;
    p.respawnAt = null;
    return true;
  }
  return false;
}

function newPlayer(id: number, name: string, colorIndex: number, isHuman: boolean): Player {
  return {
    id, name, colorIndex, isHuman,
    alive: false,
    pos: { x: 0, y: 0 },
    prevPos: { x: 0, y: 0 },
    heading: 0,
    targetHeading: 0,
    land: [],
    trail: [],
    kills: 0,
    deathTime: null,
    respawnAt: null,
    dyingLand: null,
    burn: null,
  };
}

export function createWorld(opts: {
  seed: number; humanName: string; humanColor: number; difficulty?: Difficulty;
}): World {
  const world: World = {
    time: 0, players: [], humanId: 0, events: [], over: false, won: false,
    seed: opts.seed, difficulty: opts.difficulty ?? 'normal', rngState: opts.seed >>> 0,
  };
  const rng = worldRng(world);
  const humanColor = ((opts.humanColor % COLOR_COUNT) + COLOR_COUNT) % COLOR_COUNT;
  const human = newPlayer(0, opts.humanName, humanColor, true);
  const h0 = wrap(rng() * Math.PI * 2);
  human.alive = true;
  human.heading = h0;
  human.targetHeading = h0;
  human.land = startLand(human.pos);
  world.players.push(human);

  const colors: number[] = [];
  for (let c = 0; c < COLOR_COUNT; c++) if (c !== humanColor) colors.push(c);
  for (let i = 1; i <= DIFFICULTY[world.difficulty].botCount; i++) {
    const bot = newPlayer(i, '', colors[(i - 1) % colors.length], false);
    world.players.push(bot);
    bot.name = pickName(world, rng);
    if (!spawnPlayer(world, bot, rng)) bot.respawnAt = CONFIG.SPAWN_RETRY_S;
  }
  return world;
}

export function pct(world: World, id: number): number {
  const p = world.players[id];
  if (!p) return 0;
  return (landArea(p.land) / ARENA_AREA) * 100;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
function bbox(m: MultiPoly): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const poly of m) for (const v of poly[0] ?? []) {
    if (v.x < b.x0) b.x0 = v.x;
    if (v.y < b.y0) b.y0 = v.y;
    if (v.x > b.x1) b.x1 = v.x;
    if (v.y > b.y1) b.y1 = v.y;
  }
  return b;
}
const boxesOverlap = (a: Box, b: Box) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** Records a pending death; the first recorded killer wins. */
function markDead(pending: Map<number, number | null>, victim: number, killer: number | null) {
  if (!pending.has(victim)) pending.set(victim, killer === victim ? null : killer);
}

function capture(world: World, p: Player, pending: Map<number, number | null>) {
  const before = pct(world, p.id);
  const oldLand = p.land;
  const nearWall = p.trail.some((q) => q.x * q.x + q.y * q.y > CLIP_NEAR_R * CLIP_NEAR_R);
  const newLand = captureLand(oldLand, p.trail, nearWall ? ARENA_POLY : undefined);
  p.land = newLand;
  p.trail = [];
  p.burn = null; // made it home: the burn is cancelled
  const box = bbox(newLand);
  // Only the newly gained region is lethal; enemies crossing old land are unaffected.
  const region = subtractLand(newLand, oldLand);
  for (const q of world.players) {
    if (q === p || !q.alive) continue;
    if (landContains(region, q.pos)) markDead(pending, q.id, p.id);
    if (q.land.length === 0 || !boxesOverlap(box, bbox(q.land))) continue;
    q.land = keepPiece(subtractLand(q.land, newLand), q.pos);
    if (q.land.length === 0) markDead(pending, q.id, p.id);
  }
  world.events.push({ type: 'capture', playerId: p.id, gainedPct: pct(world, p.id) - before, region });
}

/**
 * Moves p by `d` along its heading. A move that would leave the arena slides along the
 * wall's tangent at full speed instead (counter-clockwise when heading straight outward),
 * and the heading follows the wall, so holding into the wall keeps gliding along it rather
 * than chattering against it. Steering inwards leaves the wall as usual.
 */
function moveInside(p: Player, d: number): void {
  const cx = Math.cos(p.heading), cy = Math.sin(p.heading);
  const next = { x: p.pos.x + cx * d, y: p.pos.y + cy * d };
  const r = Math.hypot(p.pos.x, p.pos.y);
  if (next.x * next.x + next.y * next.y <= MOVE_R * MOVE_R || r === 0) {
    p.pos = clampToCircle(next, MOVE_R);
    return;
  }
  let tx = -p.pos.y / r, ty = p.pos.x / r;
  if (cx * tx + cy * ty < 0) { tx = -tx; ty = -ty; }
  p.pos = clampToCircle({ x: p.pos.x + tx * d, y: p.pos.y + ty * d }, MOVE_R);
  p.heading = Math.atan2(ty, tx);
}

/** Turn, move, clamp, extend trail, capture on re-entry. */
function advance(world: World, p: Player, input: Input | undefined, pending: Map<number, number | null>) {
  if (input && input.targetHeading !== null) p.targetHeading = wrap(input.targetHeading);
  const rate = p.isHuman ? CONFIG.TURN_HUMAN : DIFFICULTY[world.difficulty].botTurnRate;
  const dtTurn = Math.min(CONFIG.DT, CONFIG.TURN_DT_CAP);
  p.heading = wrap(p.heading + angleDiff(p.targetHeading, p.heading) * dtTurn * rate);

  p.prevPos = p.pos;
  const d = CONFIG.SPEED * CONFIG.DT;
  moveInside(p, d);

  const inside = landContains(p.land, p.pos);
  if (!inside) {
    if (p.trail.length === 0) p.trail.push({ ...p.prevPos });
    // Drop points at exact TRAIL_STEP spacing along the path towards the head.
    let last = p.trail[p.trail.length - 1];
    let gap = dist(last, p.pos);
    while (gap >= CONFIG.TRAIL_STEP) {
      const k = CONFIG.TRAIL_STEP / gap;
      last = { x: last.x + (p.pos.x - last.x) * k, y: last.y + (p.pos.y - last.y) * k };
      p.trail.push(last);
      gap = dist(last, p.pos);
    }
  } else if (p.trail.length > 0 && !pending.has(p.id)) {
    p.trail.push({ ...p.pos });
    capture(world, p, pending);
  } else if (p.trail.length > 0) {
    p.trail = [];
    p.burn = null;
  }
}

/** Path length of p's trail: cumulative distance along trail[0..n] plus the live tail to pos. */
export function trailLength(p: Player): number {
  const t = p.trail;
  if (t.length === 0) return 0;
  let s = 0;
  for (let i = 0; i + 1 < t.length; i++) s += dist(t[i], t[i + 1]);
  return s + dist(t[t.length - 1], p.pos);
}

/** Is the trail piece spanning path lengths [s0, s1] burnt? Partial overlap counts by midpoint. */
function isBurnt(p: Player, s0: number, s1: number): boolean {
  const b = p.burn;
  if (!b) return false;
  const m = (s0 + s1) / 2;
  return m >= b.back && m <= b.front;
}

/** Path length along segment a→b (starting at sa) of the point nearest q. */
function lengthAt(q: Vec, a: Vec, b: Vec, sa: number): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
  return sa + k * Math.sqrt(l2);
}

/** Spreads every burn by BURN_SPEED·DT both ways; a burn that reaches the head kills. */
function advanceBurns(world: World, alive: Player[], pending: Map<number, number | null>) {
  const d = DIFFICULTY[world.difficulty].burnSpeed * CONFIG.DT;
  for (const p of alive) {
    const b = p.burn;
    if (!b) continue;
    const len = trailLength(p);
    b.back = Math.max(0, b.back - d);
    b.front = Math.min(len, b.front + d);
    if (b.front >= len - 1e-9) markDead(pending, p.id, b.killerId);
  }
}

/**
 * Where a's head segment crosses b's rival trail, as a path length along it, or null.
 * A trail that is already burning is ignored: the first hitter keeps the credit.
 */
function trailHitAt(a: Player, b: Player): number | null {
  const t = b.trail;
  if (t.length === 0 || b.burn) return null;
  const p0 = a.prevPos, p1 = a.pos;
  for (let i = 0; i < t.length; i++) {
    const end = i + 1 < t.length ? t[i + 1] : b.pos;
    if (!segIntersect(p0, p1, t[i], end)) continue;
    // Path length is only needed for an actual hit: sum the segments before it.
    let s = 0;
    for (let j = 0; j < i; j++) s += dist(t[j], t[j + 1]);
    return lengthAt(p1, t[i], end, s);
  }
  return null;
}

/** Does p's head segment cross the dangerous part of its own trail? */
function hitsOwnTrail(p: Player): boolean {
  const t = p.trail;
  if (t.length === 0) return false;
  const p0 = p.prevPos, p1 = p.pos;
  const total = p.burn ? trailLength(p) : 0;
  // Skip the live tail and the last SELF_SAFE_LEN of path length; burnt pieces are harmless.
  let acc = dist(p.pos, t[t.length - 1]);
  for (let i = t.length - 2; i >= 0; i--) {
    const len = dist(t[i], t[i + 1]);
    if (acc >= CONFIG.SELF_SAFE_LEN && segIntersect(p0, p1, t[i], t[i + 1])
      && !isBurnt(p, total - acc - len, total - acc)) return true;
    acc += len;
  }
  return false;
}

function resolveCollisions(world: World, alive: Player[], pending: Map<number, number | null>) {
  for (const a of alive) {
    for (const b of alive) {
      if (a === b) {
        if (hitsOwnTrail(a)) markDead(pending, a.id, a.id);
        continue;
      }
      // A rival trail hit doesn't kill outright: it sets the trail burning from the hit point.
      const s = trailHitAt(a, b);
      if (s !== null) b.burn = { s0: s, back: s, front: s, killerId: a.id };
    }
  }
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      if (dist(a.pos, b.pos) >= CONFIG.HEAD_ON_DIST) continue;
      const aa = landArea(a.land), ba = landArea(b.land);
      const eps = 1e-6 * Math.max(aa, ba, 1);
      if (Math.abs(aa - ba) <= eps) {
        markDead(pending, a.id, b.id);
        markDead(pending, b.id, a.id);
      } else if (aa < ba) markDead(pending, a.id, b.id);
      else markDead(pending, b.id, a.id);
    }
  }
}

function applyDeaths(world: World, pending: Map<number, number | null>) {
  for (const [id, killerId] of pending) {
    const p = world.players[id];
    if (!p.alive) continue;
    p.alive = false;
    p.trail = [];
    p.burn = null;
    p.dyingLand = p.land.length > 0 ? p.land : null;
    p.land = [];
    p.deathTime = world.time;
    p.respawnAt = p.isHuman ? null : world.time + CONFIG.BOT_RESPAWN_S;
    if (killerId !== null) world.players[killerId].kills++;
    world.events.push({ type: 'death', playerId: id, killerId });
  }
}

function housekeeping(world: World) {
  const rng = worldRng(world);
  for (const p of world.players) {
    if (p.dyingLand && p.deathTime !== null && world.time - p.deathTime >= CONFIG.DEATH_SHRINK_S - 1e-9) {
      p.dyingLand = null;
    }
    if (!p.alive && !p.isHuman && p.respawnAt !== null && world.time >= p.respawnAt - 1e-9) {
      const old = p.name;
      p.name = pickName(world, rng, old);
      if (!spawnPlayer(world, p, rng)) {
        p.name = old;
        p.respawnAt = world.time + CONFIG.SPAWN_RETRY_S;
      }
    }
  }
}

/** Advances the world by CONFIG.DT. world.events holds only this tick's events. */
export function step(world: World, inputs: Map<number, Input>): void {
  if (world.over) return;
  world.events = [];
  world.time += CONFIG.DT;
  const pending = new Map<number, number | null>();

  const alive = world.players.filter((p) => p.alive);
  for (const p of alive) advance(world, p, inputs.get(p.id), pending);
  advanceBurns(world, alive, pending);
  resolveCollisions(world, alive, pending);
  applyDeaths(world, pending);
  housekeeping(world);

  const human = world.players[world.humanId];
  if (!human.alive) {
    world.over = true;
    world.events.push({ type: 'gameover' });
  } else if (pct(world, human.id) >= CONFIG.WIN_PCT) {
    world.won = true;
    world.over = true;
    world.events.push({ type: 'win' });
  }
}
