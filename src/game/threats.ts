/**
 * Which rivals are bearing down on the human's trail, from World alone (pure; no DOM, no
 * canvas). The shell turns the list into the trail glow, the off-screen arrows, the minimap
 * rings and the alert blip.
 */
import type { Vec } from '../sim/geometry';
import type { World } from '../sim/types';

/** A rival head within this many world units of the human's trail is a threat. */
export const THREAT_RANGE = 18;
/** At most this many threats are reported (closest first). */
export const MAX_THREATS = 3;
/** The trail's last stretch (u) behind the head doesn't count: that's the head's own reach. */
export const THREAT_HEAD_SKIP = 1;
/** The alert blip sounds when a rival becomes the closest threat under this distance. */
export const ALERT_DIST = 8;
/** Seconds before the same rival can set the blip off again. */
export const ALERT_COOLDOWN_S = 2;

export type Threat = {
  /** The rival's player id. */
  id: number;
  colorIndex: number;
  /** Distance (u) from the rival's head to the nearest counted point of the human's trail. */
  dist: number;
  /** The rival's head (a copy, sim position). */
  pos: Vec;
  /** The nearest counted point of the human's trail. */
  trailPoint: Vec;
  /** Path length of trailPoint along the human's trail, from trail[0]. */
  trailS: number;
};

/** Threat objects dropped from some `out`, kept to refill one later without allocating. */
const spare: Threat[] = [];

const newThreat = (): Threat => ({ id: 0, colorIndex: 0, dist: 0, pos: { x: 0, y: 0 }, trailPoint: { x: 0, y: 0 }, trailS: 0 });

/** Shrinks out to n entries, keeping the dropped objects for reuse. */
function truncate(out: Threat[], n: number): Threat[] {
  for (let i = n; i < out.length; i++) spare.push(out[i]);
  out.length = n;
  return out;
}

/**
 * Fills `out` with the alive rivals whose heads are within THREAT_RANGE of the human's trail
 * (trail[0] → head, minus the last THREAT_HEAD_SKIP u), closest first, at most MAX_THREATS.
 * Empty unless the human is out of its land with a live trail. Returns `out`; its threat
 * objects are reused from call to call, so they are only valid until the next call.
 */
export function findThreats(world: World, out: Threat[]): Threat[] {
  const h = world.players[world.humanId];
  const t = h.trail;
  if (!h.alive || world.awaitingRevive || world.over || t.length === 0) return truncate(out, 0);

  // Path length of trail + live tail, and the bounding box of trail + head (conservative).
  let total = 0;
  let minX = h.pos.x, maxX = minX, minY = h.pos.y, maxY = minY;
  for (let i = 0; i < t.length; i++) {
    const a = t[i], b = i + 1 < t.length ? t[i + 1] : h.pos;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    if (a.x < minX) minX = a.x; else if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y; else if (a.y > maxY) maxY = a.y;
  }
  const limit = total - THREAT_HEAD_SKIP;
  if (limit <= 0) return truncate(out, 0);

  let n = 0;
  const r2 = THREAT_RANGE * THREAT_RANGE;
  for (const r of world.players) {
    if (r.isHuman || !r.alive) continue;
    const q = r.pos;
    const bx = q.x < minX ? minX - q.x : q.x > maxX ? q.x - maxX : 0;
    const by = q.y < minY ? minY - q.y : q.y > maxY ? q.y - maxY : 0;
    if (bx * bx + by * by > r2) continue;

    let best = Infinity, px = 0, py = 0, ps = 0;
    let acc = 0;
    for (let i = 0; i < t.length && acc < limit; i++) {
      const a = t[i], b = i + 1 < t.length ? t[i + 1] : h.pos;
      let dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (acc + len > limit) {
        // The counted trail ends inside this segment.
        const k = len > 0 ? (limit - acc) / len : 0;
        dx *= k;
        dy *= k;
      }
      const len2 = dx * dx + dy * dy;
      let k = len2 > 0 ? ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2 : 0;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const x = a.x + dx * k, y = a.y + dy * k;
      const d2 = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
      if (d2 < best) { best = d2; px = x; py = y; ps = acc + Math.sqrt(len2) * k; }
      acc += len;
    }
    if (best > r2) continue;
    const d = Math.sqrt(best);
    if (n === MAX_THREATS && d >= out[n - 1].dist) continue;

    // Take a slot at the end (reusing whatever object sits there), then sift it into place.
    let slot: Threat;
    if (n < MAX_THREATS) {
      slot = out[n] ?? spare.pop() ?? newThreat();
      n++;
    } else {
      slot = out[n - 1];
    }
    let j = n - 1;
    while (j > 0 && out[j - 1].dist > d) {
      out[j] = out[j - 1];
      j--;
    }
    out[j] = slot;
    slot.id = r.id;
    slot.colorIndex = r.colorIndex;
    slot.dist = d;
    slot.pos.x = q.x;
    slot.pos.y = q.y;
    slot.trailPoint.x = px;
    slot.trailPoint.y = py;
    slot.trailS = ps;
  }
  return truncate(out, n);
}

/** What the alert blip remembers: real time, the last closest threat and when each rival blipped. */
export type ThreatAlert = { time: number; closest: number | null; last: Map<number, number> };

export function createThreatAlert(): ThreatAlert {
  return { time: 0, closest: null, last: new Map() };
}

/**
 * Advances the alert by dt real seconds with this frame's threats (closest first). True when
 * the blip should play: a rival has just become the closest threat under ALERT_DIST and it
 * hasn't blipped in the last ALERT_COOLDOWN_S.
 */
export function tickThreatAlert(a: ThreatAlert, threats: readonly Threat[], dt: number): boolean {
  a.time += dt;
  const c = threats.length > 0 && threats[0].dist < ALERT_DIST ? threats[0].id : null;
  let fire = false;
  if (c !== null && c !== a.closest) {
    const last = a.last.get(c);
    if (last === undefined || a.time - last >= ALERT_COOLDOWN_S - 1e-9) {
      fire = true;
      a.last.set(c, a.time);
    }
  }
  a.closest = c;
  return fire;
}
