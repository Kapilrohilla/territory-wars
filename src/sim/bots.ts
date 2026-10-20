import { CONFIG, DIFFICULTY } from './config';
import {
  type Ring, type Vec,
  angleDiff, distPointSeg, pointInRing, segIntersect,
} from './geometry';
import { landContains } from './territory';
import type { Input, Player, World } from './types';

export type BotBrain = {
  state: 'home' | 'out' | 'return' | 'hunt';
  waypoints: Vec[];
  /** Identity of the life this brain was built for (used to detect respawns). */
  name?: string;
  alive?: boolean;
};

// Tuning constants.
const CAUTION_HUMAN_DIST = 12; // u
const HUNT_AHEAD_LEN = 10; // u
const HUNT_SIDE_LEN = 15; // u
const HUNT_SIDE_ANGLE = Math.PI / 4; // 45 deg
const WALL_RADIUS = 92;
const WALL_PULL = 1.5;
const SELF_LOOKAHEAD = 3; // u
const SELF_ROTATE = Math.PI / 3; // 60 deg
const WAYPOINT_MIN = 3;
const WAYPOINT_REACH = 1.5;
const WAYPOINT_LIMIT_R = 90;
const MAX_TRAIL_LEN = 40; // u; beyond this an 'out' bot turns back
const OUTWARD_JITTER = 0.6; // rad
const SELF_IGNORE_LEN = 1.5; // u of own trail nearest the head ignored for lookahead

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const trailLen = (p: Player) => p.trail.length * CONFIG.TRAIL_STEP;

function freshBrain(p: Player): BotBrain {
  return { state: 'home', waypoints: [], name: p.name, alive: p.alive };
}

export function createBrains(world: World): Map<number, BotBrain> {
  const m = new Map<number, BotBrain>();
  for (const p of world.players) if (!p.isHuman) m.set(p.id, freshBrain(p));
  return m;
}

function clampR(v: Vec, r: number): Vec {
  const d = Math.hypot(v.x, v.y);
  return d > r ? { x: (v.x / d) * r, y: (v.y / d) * r } : v;
}

function outerRings(p: Player): Ring[] {
  return p.land.map((poly) => poly[0]).filter((r): r is Ring => !!r && r.length > 0);
}

function ringFor(p: Player): Ring | null {
  const rings = outerRings(p);
  if (rings.length === 0) return null;
  for (const r of rings) if (pointInRing(p.pos, r)) return r;
  let best = rings[0], bd = Infinity;
  for (const r of rings) for (const v of r) {
    const d = dist(v, p.pos);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

function planTrip(world: World, p: Player, brain: BotBrain, rng: () => number) {
  const ring = ringFor(p);
  if (!ring) { brain.waypoints = []; brain.state = 'return'; return; }
  const b = ring[Math.floor(rng() * ring.length) % ring.length];
  let cx = 0, cy = 0;
  for (const v of ring) { cx += v.x; cy += v.y; }
  cx /= ring.length; cy /= ring.length;
  let dir = Math.atan2(b.y - cy, b.x - cx) + (rng() * 2 - 1) * OUTWARD_JITTER;
  const span = DIFFICULTY[world.difficulty].waypointMax - WAYPOINT_MIN;
  const d1 = WAYPOINT_MIN + rng() * span;
  const w1 = clampR({ x: b.x + Math.cos(dir) * d1, y: b.y + Math.sin(dir) * d1 }, WAYPOINT_LIMIT_R);
  const side = rng() < 0.5 ? -1 : 1;
  dir += side * (Math.PI / 3 + rng() * (Math.PI / 4));
  const d2 = WAYPOINT_MIN + rng() * span;
  const w2 = clampR({ x: w1.x + Math.cos(dir) * d2, y: w1.y + Math.sin(dir) * d2 }, WAYPOINT_LIMIT_R);
  brain.waypoints = [b, w1, w2];
  brain.state = 'out';
}

function nearestOnSeg(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function nearestOnLand(p: Player): Vec | null {
  let best: Vec | null = null, bd = Infinity;
  for (const r of outerRings(p)) {
    for (let i = 0; i < r.length; i++) {
      const q = nearestOnSeg(p.pos, r[i], r[(i + 1) % r.length]);
      const d = dist(q, p.pos);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return best;
}

/** Segments of a player's trail including the live tail to its head. */
function trailSegs(t: Player): [Vec, Vec][] {
  const s: [Vec, Vec][] = [];
  for (let i = 0; i + 1 < t.trail.length; i++) s.push([t.trail[i], t.trail[i + 1]]);
  if (t.trail.length > 0) s.push([t.trail[t.trail.length - 1], t.pos]);
  return s;
}

/**
 * Nearest point of the human trail if it lies on one of the hunt rays. A trail that is
 * already burning (a hit is ignored) or a protected human can't be hurt, so isn't hunted.
 */
function huntTarget(world: World, p: Player, human: Player): Vec | null {
  if (!human.alive || human.trail.length === 0 || human.burn || world.time < human.protectedUntil) return null;
  const segs = trailSegs(human);
  const h = p.heading;
  const mul = DIFFICULTY[world.difficulty].huntRangeMul;
  const rays: [number, number][] = [
    [h, HUNT_AHEAD_LEN * mul], [h + HUNT_SIDE_ANGLE, HUNT_SIDE_LEN * mul], [h - HUNT_SIDE_ANGLE, HUNT_SIDE_LEN * mul],
  ];
  let hit = false;
  for (const [a, len] of rays) {
    const e = { x: p.pos.x + Math.cos(a) * len, y: p.pos.y + Math.sin(a) * len };
    for (const [s0, s1] of segs) if (segIntersect(p.pos, e, s0, s1)) { hit = true; break; }
    if (hit) break;
  }
  if (!hit) return null;
  let best: Vec | null = null, bd = Infinity;
  for (const [s0, s1] of segs) {
    const q = nearestOnSeg(p.pos, s0, s1);
    const d = dist(q, p.pos);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Does a ray along `ang` cross this bot's own (dangerous part of its) trail within SELF_LOOKAHEAD? */
function crossesOwnTrail(p: Player, ang: number): boolean {
  const t = p.trail;
  if (t.length < 2) return false;
  const e = { x: p.pos.x + Math.cos(ang) * SELF_LOOKAHEAD, y: p.pos.y + Math.sin(ang) * SELF_LOOKAHEAD };
  let acc = dist(p.pos, t[t.length - 1]);
  for (let i = t.length - 2; i >= 0; i--) {
    const len = dist(t[i], t[i + 1]);
    if (acc >= SELF_IGNORE_LEN) {
      if (segIntersect(p.pos, e, t[i], t[i + 1])) return true;
      if (distPointSeg(e, t[i], t[i + 1]) < 0.5) return true;
    }
    acc += len;
  }
  return false;
}

function avoidSelf(p: Player, ang: number): number {
  if (p.trail.length < 2) return ang;
  const opts = [ang, ang + SELF_ROTATE, ang - SELF_ROTATE, ang + 2 * SELF_ROTATE, ang - 2 * SELF_ROTATE];
  // Prefer the rotation closest to the current heading when the straight line is blocked.
  const rest = opts.slice(1).sort((a, b) => Math.abs(angleDiff(a, p.heading)) - Math.abs(angleDiff(b, p.heading)));
  for (const a of [opts[0], ...rest]) {
    if (!crossesOwnTrail(p, a) && !crossesOwnTrail(p, p.heading + angleDiff(a, p.heading) / 2)) return a;
  }
  return ang;
}

function steerTo(p: Player, target: Vec): number {
  return Math.atan2(target.y - p.pos.y, target.x - p.pos.x);
}

function think(world: World, p: Player, brain: BotBrain, rng: () => number): number {
  const human = world.players[world.humanId];
  const inside = landContains(p.land, p.pos);
  const tl = trailLen(p);
  const cautionTrail = DIFFICULTY[world.difficulty].cautionTrail;

  if (brain.state === 'hunt') brain.state = 'return';

  // Caution: long trail with the human close by.
  if (tl > cautionTrail && human.alive && dist(human.pos, p.pos) < CAUTION_HUMAN_DIST) {
    brain.state = 'return';
  }
  if (brain.state === 'out' && tl > MAX_TRAIL_LEN) brain.state = 'return';
  // Own trail burning: race the burn home; no hunting.
  if (p.burn) brain.state = 'return';

  // Hunt overrides, unless carrying a long trail or burning.
  const prey = tl <= cautionTrail && !p.burn ? huntTarget(world, p, human) : null;
  if (prey) {
    brain.state = 'hunt';
    return finish(p, steerTo(p, prey));
  }

  if (brain.state === 'return' && inside && p.trail.length === 0) brain.state = 'home';
  if (brain.state === 'home') {
    if (inside || p.land.length === 0) planTrip(world, p, brain, rng);
    else brain.state = 'return';
  }

  let target: Vec | null = null;
  if (brain.state === 'out') {
    while (brain.waypoints.length > 0 && dist(p.pos, brain.waypoints[0]) < WAYPOINT_REACH) brain.waypoints.shift();
    if (brain.waypoints.length === 0) brain.state = 'return';
    else target = brain.waypoints[0];
  }
  if (brain.state === 'return') {
    target = inside && p.trail.length > 0 ? p.pos : nearestOnLand(p);
    if (!target) target = { x: 0, y: 0 };
  }
  return finish(p, target ? steerTo(p, target) : p.heading);
}

function finish(p: Player, ang: number): number {
  let a = ang;
  const r = Math.hypot(p.pos.x, p.pos.y);
  if (r > WALL_RADIUS) {
    const cx = Math.cos(a) + WALL_PULL * (-p.pos.x / r);
    const cy = Math.sin(a) + WALL_PULL * (-p.pos.y / r);
    a = Math.atan2(cy, cx);
  }
  return avoidSelf(p, a);
}

export function botInputs(
  world: World,
  brains: Map<number, BotBrain>,
  rng: () => number,
): Map<number, Input> {
  const out = new Map<number, Input>();
  for (const p of world.players) {
    if (p.isHuman) continue;
    let brain = brains.get(p.id);
    if (!brain) { brain = freshBrain(p); brains.set(p.id, brain); }
    if (!p.alive) { brain.alive = false; continue; }
    if (!brain.alive || brain.name !== p.name) {
      brain.state = 'home';
      brain.waypoints = [];
      brain.name = p.name;
      brain.alive = true;
    }
    out.set(p.id, { targetHeading: think(world, p, brain, rng) });
  }
  return out;
}
