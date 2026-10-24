import { CONFIG, DIFFICULTY, type DifficultyTuning } from './config';
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
  /**
   * Pack hunting (Hard): this bot's slot in the pack hunting the human (0 = aims nearest
   * the head, 1 = PINCER_GAP further back, ...), or -1 when not committed.
   */
  pack?: number;
  /** World time of the last pack evaluation (shared by all brains of a world). */
  packAt?: number;
  /** Scratch for the pack evaluation: distance to the human trail (Infinity = not eligible). */
  packDist?: number;
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
// Smarter (Hard) bots; all gated by the DifficultyTuning flags.
// smartHunt: cost = distToBot + HEAD_COST · pathLengthFromHumanHead. Below 1, or the head
// itself always wins (d(head) ≤ d(q) + path(q)) and the bot rams it head-on instead of cutting.
const HEAD_COST = 0.6;
const CUT_BEHIND = 2; // u of path length behind the head the nearest aim point sits (slot 0)
const REACH_SLACK_S = 0.4; // a hunt must arrive within this long after the human gets home
const PACK_EVAL_S = 0.5; // pack commitment is re-picked this often (world time)
const PINCER_GAP = 6; // u of human path length between committed bots' aim points
const RAID_RANGE = 30; // u; a raid only targets human land this close
const RAID_DEPTH = 2; // u the raid waypoint sits past the human land's edge
const SAFE_MARGIN = 2; // u
const SAFE_TRIP_TRIES = 3; // safeReturn: candidate start vertices per trip (the most open one wins)
const SAFE_TRIP_LOOK = 10; // u past the start vertex where a trip's openness is measured
const SAFE_TRIP_WALL = 20; // u; the wall counts as a rival head this much further away

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
  const tune = DIFFICULTY[world.difficulty];
  if (tune.raidChance > 0 && rng() < tune.raidChance && planRaid(world, p, brain, ring, tune, rng)) return;
  let b = ring[Math.floor(rng() * ring.length) % ring.length];
  let cx = 0, cy = 0;
  for (const v of ring) { cx += v.x; cy += v.y; }
  cx /= ring.length; cy /= ring.length;
  if (tune.safeReturn) {
    // Safe trips: of a few random start vertices, leave from the one facing the most open ground.
    let open = openness(world, p, b, cx, cy);
    for (let k = 1; k < SAFE_TRIP_TRIES; k++) {
      const c = ring[Math.floor(rng() * ring.length) % ring.length];
      const o = openness(world, p, c, cx, cy);
      if (o > open) { open = o; b = c; }
    }
  }
  let dir = Math.atan2(b.y - cy, b.x - cx) + (rng() * 2 - 1) * OUTWARD_JITTER;
  const span = tune.waypointMax * tune.loopScale - WAYPOINT_MIN;
  const d1 = WAYPOINT_MIN + rng() * span;
  const w1 = clampR({ x: b.x + Math.cos(dir) * d1, y: b.y + Math.sin(dir) * d1 }, WAYPOINT_LIMIT_R);
  const side = rng() < 0.5 ? -1 : 1;
  dir += side * (Math.PI / 3 + rng() * (Math.PI / 4));
  const d2 = WAYPOINT_MIN + rng() * span;
  const w2 = clampR({ x: w1.x + Math.cos(dir) * d2, y: w1.y + Math.sin(dir) * d2 }, WAYPOINT_LIMIT_R);
  brain.waypoints = [b, w1, w2];
  brain.state = 'out';
}

/**
 * How open the ground is outside ring vertex b (ring centre cx, cy): the distance from a
 * point SAFE_TRIP_LOOK out past b to the nearest rival head, or to the wall plus
 * SAFE_TRIP_WALL, whichever is nearer.
 */
function openness(world: World, p: Player, b: Vec, cx: number, cy: number): number {
  const a = Math.atan2(b.y - cy, b.x - cx);
  const ox = b.x + Math.cos(a) * SAFE_TRIP_LOOK, oy = b.y + Math.sin(a) * SAFE_TRIP_LOOK;
  let m = CONFIG.ARENA_R - Math.hypot(ox, oy) + SAFE_TRIP_WALL;
  for (const r of world.players) {
    if (r === p || !r.alive) continue;
    const d = Math.hypot(r.pos.x - ox, r.pos.y - oy);
    if (d < m) m = d;
  }
  return m;
}

/**
 * A raid (Hard): leave from the own-land vertex nearest the human's land, cut RAID_DEPTH
 * into its nearest edge, swing sideways and come home, so the captured loop takes a bite
 * of the human's land. False (no plan made) when that land is more than RAID_RANGE away.
 */
function planRaid(world: World, p: Player, brain: BotBrain, ring: Ring, tune: DifficultyTuning, rng: () => number): boolean {
  const human = world.players[world.humanId];
  if (!human.alive) return false;
  const edge = nearestOnRings(human, p.pos);
  if (!edge || dist(edge, p.pos) > RAID_RANGE) return false;
  let b = ring[0], bd = Infinity;
  for (const q of ring) {
    const d = dist(q, edge);
    if (d < bd) { bd = d; b = q; }
  }
  const dir = Math.atan2(edge.y - b.y, edge.x - b.x);
  const r = clampR({ x: edge.x + Math.cos(dir) * RAID_DEPTH, y: edge.y + Math.sin(dir) * RAID_DEPTH }, WAYPOINT_LIMIT_R);
  const side = rng() < 0.5 ? -1 : 1;
  const back = dir + Math.PI - side * (Math.PI / 3 + rng() * (Math.PI / 6));
  const d2 = WAYPOINT_MIN + rng() * (tune.waypointMax * tune.loopScale - WAYPOINT_MIN) * 0.5;
  const w2 = clampR({ x: r.x + Math.cos(back) * d2, y: r.y + Math.sin(back) * d2 }, WAYPOINT_LIMIT_R);
  brain.waypoints = [b, r, w2];
  brain.state = 'out';
  return true;
}

function nearestOnSeg(p: Vec, a: Vec, b: Vec): Vec {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function nearestOnLand(p: Player): Vec | null {
  return nearestOnRings(p, p.pos);
}

/** Nearest point to `at` on the outer rings of p's land (null without land). */
function nearestOnRings(p: Player, at: Vec): Vec | null {
  let best: Vec | null = null, bd = Infinity;
  for (const r of outerRings(p)) {
    for (let i = 0; i < r.length; i++) {
      const q = nearestOnSeg(at, r[i], r[(i + 1) % r.length]);
      const d = dist(q, at);
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

/**
 * The human's trail as seen by smartHunt, computed once per botInputs call: whether it can
 * be hunted at all, its path length (trail + live tail), its bounding box (trail + head) and
 * how far the human's head is from its own land. Plain module scratch, no per-tick allocation.
 */
const prey = { ok: false, total: 0, minX: 0, minY: 0, maxX: 0, maxY: 0, homeDist: 0, nearest: Infinity };

function scanPrey(world: World): void {
  const h = world.players[world.humanId];
  const t = h.trail;
  prey.ok = h.alive && t.length > 0 && !h.burn && world.time >= h.protectedUntil;
  if (!prey.ok) return;
  let total = 0;
  let minX = h.pos.x, maxX = minX, minY = h.pos.y, maxY = minY;
  for (let i = 0; i < t.length; i++) {
    const a = t[i], b = i + 1 < t.length ? t[i + 1] : h.pos;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    if (a.x < minX) minX = a.x; else if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y; else if (a.y > maxY) maxY = a.y;
  }
  prey.total = total;
  prey.minX = minX; prey.maxX = maxX; prey.minY = minY; prey.maxY = maxY;
  const home = nearestOnLand(h);
  prey.homeDist = home ? dist(home, h.pos) : Infinity;
}

/**
 * smartHunt aim point for a bot in pack slot `slot`, or null when the human's trail is out
 * of huntRadius or can't be reached before the human gets home. Among the trail points at
 * least CUT_BEHIND of path length behind the head, picks the one minimising
 * distToBot + HEAD_COST·pathFromHead: a real trail point to cut, never the head. Slot k > 0
 * then aims at the best point a further k·PINCER_GAP behind slot 0's point.
 * Leaves the bot's distance to the nearest trail point in prey.nearest.
 */
function smartTarget(world: World, p: Player, tune: DifficultyTuning, slot: number): Vec | null {
  prey.nearest = Infinity;
  if (!prey.ok) return null;
  const R = tune.huntRadius;
  const px = p.pos.x, py = p.pos.y;
  const bx = px < prey.minX ? prey.minX - px : px > prey.maxX ? px - prey.maxX : 0;
  const by = py < prey.minY ? prey.minY - py : py > prey.maxY ? py - prey.maxY : 0;
  if (bx * bx + by * by > R * R) return null;

  const h = world.players[world.humanId];
  const t = h.trail;
  let best = bestCut(h, px, py, prey.total - CUT_BEHIND);
  if (prey.nearest > R) return null;
  if (slot > 0) best = bestCut(h, px, py, cutS - PINCER_GAP * slot);
  // A trail shorter than the offset: best stays 0 (the trail's start).
  const target = t[best];
  // Reachable before the human is home: botDist/SPEED < homeDist/SPEED + slack.
  if (dist(target, p.pos) / CONFIG.SPEED >= prey.homeDist / CONFIG.SPEED + REACH_SLACK_S) return null;
  return target;
}

let cutS = 0; // path length (from trail[0]) of the point bestCut last picked
/**
 * Index of the human trail point (path length ≤ maxS) minimising
 * dist to (px, py) + HEAD_COST·pathFromHead; sets cutS, and prey.nearest (trail and head).
 */
function bestCut(h: Player, px: number, py: number, maxS: number): number {
  const t = h.trail;
  let nearest = Infinity, bestCost = Infinity, best = 0;
  let s = 0, lx = t[0].x, ly = t[0].y;
  cutS = 0;
  for (let i = 0; i <= t.length; i++) {
    const q = i < t.length ? t[i] : h.pos;
    s += Math.hypot(q.x - lx, q.y - ly);
    lx = q.x; ly = q.y;
    const d = Math.hypot(q.x - px, q.y - py);
    if (d < nearest) nearest = d;
    if (s <= maxS + 1e-9) {
      const cost = d + HEAD_COST * (prey.total - s);
      if (cost < bestCost && i < t.length) { bestCost = cost; best = i; cutS = s; }
    }
  }
  prey.nearest = nearest;
  return best;
}

/** Can this bot (alive, not burning, short trail) hunt with smartHunt at all? */
const canHunt = (world: World, p: Player) => !p.burn && trailLen(p) <= DIFFICULTY[world.difficulty].cautionTrail;

/**
 * Pack hunting (Hard): every PACK_EVAL_S of world time, the packSize bots closest to the
 * human's trail that could hunt it right now are committed (slots 0.., closest first);
 * everyone else keeps expanding. The state lives in the brains (pack, packAt, packDist).
 */
function evaluatePack(world: World, brains: Map<number, BotBrain>, tune: DifficultyTuning): void {
  let due = false;
  for (const b of brains.values()) {
    if (b.packAt === undefined || world.time - b.packAt >= PACK_EVAL_S - 1e-9) { due = true; break; }
  }
  if (!due) return;
  for (const p of world.players) {
    if (p.isHuman) continue;
    const b = brains.get(p.id);
    if (!b) continue;
    b.pack = -1;
    b.packAt = world.time;
    b.packDist = p.alive && canHunt(world, p) && smartTarget(world, p, tune, 0) ? prey.nearest : Infinity;
  }
  for (let k = 0; k < tune.packSize; k++) {
    let pick: BotBrain | null = null;
    for (const b of brains.values()) {
      if (b.pack === -1 && b.packDist !== undefined && b.packDist < (pick?.packDist ?? Infinity)) pick = b;
    }
    if (!pick) break;
    pick.pack = k;
  }
}

/**
 * Safe return (Hard): is a rival head (the human or a bot) nearer some point of p's trail
 * than p is to its own land (plus SAFE_MARGIN)? Rivals are culled on the trail's bounding box.
 */
function trailThreatened(world: World, p: Player): boolean {
  const t = p.trail;
  if (t.length === 0) return false;
  const home = nearestOnLand(p);
  if (!home) return false;
  const thr = dist(home, p.pos) + SAFE_MARGIN;
  const thr2 = thr * thr;
  let minX = p.pos.x, maxX = minX, minY = p.pos.y, maxY = minY;
  for (let i = 0; i < t.length; i++) {
    const a = t[i];
    if (a.x < minX) minX = a.x; else if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y; else if (a.y > maxY) maxY = a.y;
  }
  for (const r of world.players) {
    if (r === p || !r.alive) continue;
    const qx = r.pos.x, qy = r.pos.y;
    const bx = qx < minX ? minX - qx : qx > maxX ? qx - maxX : 0;
    const by = qy < minY ? minY - qy : qy > maxY ? qy - maxY : 0;
    if (bx * bx + by * by > thr2) continue;
    for (let i = 0; i < t.length; i++) {
      const dx = t[i].x - qx, dy = t[i].y - qy;
      if (dx * dx + dy * dy < thr2) return true;
    }
  }
  return false;
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
  const tune = DIFFICULTY[world.difficulty];
  const cautionTrail = tune.cautionTrail;

  if (brain.state === 'hunt') brain.state = 'return';

  // Caution: long trail with the human close by.
  if (tl > cautionTrail && human.alive && dist(human.pos, p.pos) < CAUTION_HUMAN_DIST) {
    brain.state = 'return';
  }
  if (brain.state === 'out' && tl > MAX_TRAIL_LEN * tune.loopScale) brain.state = 'return';
  // Safe return: a rival head could reach the trail before this bot gets home.
  if (tune.safeReturn && brain.state === 'out' && trailThreatened(world, p)) brain.state = 'return';
  // Own trail burning: race the burn home; no hunting.
  if (p.burn) brain.state = 'return';

  // Hunt overrides, unless carrying a long trail or burning.
  let aim: Vec | null = null;
  if (tl <= cautionTrail && !p.burn) {
    if (!tune.smartHunt) aim = huntTarget(world, p, human);
    else if (tune.packSize <= 0) aim = smartTarget(world, p, tune, 0);
    else if ((brain.pack ?? -1) >= 0) aim = smartTarget(world, p, tune, brain.pack!);
  }
  if (aim) {
    brain.state = 'hunt';
    return finish(p, steerTo(p, aim));
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
  const tune = DIFFICULTY[world.difficulty];
  if (tune.smartHunt) {
    scanPrey(world);
    if (tune.packSize > 0) evaluatePack(world, brains, tune);
  }
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
      if (brain.pack !== undefined) brain.pack = -1;
    }
    out.set(p.id, { targetHeading: think(world, p, brain, rng) });
  }
  return out;
}
