import { describe, it, expect } from 'vitest';
import {
  ALERT_COOLDOWN_S, ALERT_DIST, MAX_THREATS, THREAT_RANGE, createThreatAlert, findThreats, tickThreatAlert,
  type Threat,
} from '../src/game/threats';
import { createWorld } from '../src/sim/world';
import type { World } from '../src/sim/types';
import { circleRing, type MultiPoly, type Vec } from '../src/sim/geometry';

const v = (x: number, y: number): Vec => ({ x, y });
const disk = (c: Vec, r: number, n = 24): MultiPoly => [[circleRing(c, r, n)]];

/** Seed-1 world with every bot out of play; the human owns a radius-3 disk at the origin. */
function soloWorld(): World {
  const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 0 });
  for (const p of w.players) {
    if (p.isHuman) continue;
    p.alive = false;
    p.land = [];
    p.trail = [];
  }
  const h = w.players[w.humanId];
  h.land = disk(v(0, 0), 3);
  h.pos = v(0, 0);
  h.prevPos = v(0, 0);
  h.trail = [];
  return w;
}

/** The human out on a straight trail along +x from (3, 0); the head ends at (3 + len, 0). */
function outOnTrail(w: World, len: number): void {
  const h = w.players[w.humanId];
  h.trail = [];
  for (let s = 0; s < len; s += 1) h.trail.push(v(3 + s, 0));
  h.pos = v(3 + len, 0);
  h.prevPos = { ...h.pos };
}

function placeRival(w: World, id: number, pos: Vec): void {
  const b = w.players[id];
  b.alive = true;
  b.pos = { ...pos };
  b.prevPos = { ...pos };
}

describe('findThreats', () => {
  it('finds an alive rival whose head is within 18 u of the trail', () => {
    const w = soloWorld();
    outOnTrail(w, 20); // trail from (3,0) to the head at (23,0)
    placeRival(w, 1, v(10, 12));
    placeRival(w, 2, v(10, 19)); // just out of range
    const out = findThreats(w, []);
    expect(out.map((t) => t.id)).toEqual([1]);
    const t = out[0];
    expect(t.dist).toBeCloseTo(12, 6);
    expect(t.trailPoint.x).toBeCloseTo(10, 6);
    expect(t.trailPoint.y).toBeCloseTo(0, 6);
    expect(t.pos).toEqual({ x: 10, y: 12 });
    expect(t.colorIndex).toBe(w.players[1].colorIndex);
    expect(THREAT_RANGE).toBe(18);
  });

  it('ignores dead rivals', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    placeRival(w, 1, v(10, 2));
    w.players[1].alive = false;
    expect(findThreats(w, [])).toEqual([]);
  });

  it('finds none while the human is home', () => {
    const w = soloWorld();
    placeRival(w, 1, v(1, 1));
    expect(findThreats(w, [])).toEqual([]);
  });

  it('finds none while awaiting revive or over', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    placeRival(w, 1, v(10, 2));
    w.awaitingRevive = true;
    expect(findThreats(w, [])).toEqual([]);
    w.awaitingRevive = false;
    w.over = true;
    expect(findThreats(w, [])).toEqual([]);
  });

  it('sorts by distance and caps at 3', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    placeRival(w, 1, v(8, 9));
    placeRival(w, 2, v(8, -3));
    placeRival(w, 3, v(12, 15));
    placeRival(w, 4, v(12, -6));
    placeRival(w, 5, v(15, 1));
    const out = findThreats(w, []);
    expect(MAX_THREATS).toBe(3);
    expect(out.map((t) => t.id)).toEqual([5, 2, 4]);
    expect(out.map((t) => t.dist)).toEqual([...out.map((t) => t.dist)].sort((a, b) => a - b));
  });

  it('excludes the last 1 u of trail near the head', () => {
    const w = soloWorld();
    outOnTrail(w, 20); // head at (23, 0); the trail counts only up to x = 22
    placeRival(w, 1, v(23, 5)); // straight above the head
    const t = findThreats(w, [])[0];
    expect(t.trailPoint.x).toBeCloseTo(22, 6);
    expect(t.dist).toBeCloseTo(Math.hypot(1, 5), 6);
    // Just ahead of the head: measured from the cut-off point, not the head.
    placeRival(w, 1, v(40, 0));
    expect(findThreats(w, [])[0].dist).toBeCloseTo(18, 6);
    placeRival(w, 1, v(40.5, 0));
    expect(findThreats(w, [])).toEqual([]);
  });

  it('finds none on a trail no longer than the excluded stretch', () => {
    const w = soloWorld();
    const h = w.players[w.humanId];
    h.trail = [v(3, 0)];
    h.pos = v(3.8, 0);
    placeRival(w, 1, v(3, 1));
    expect(findThreats(w, [])).toEqual([]);
  });

  it('reuses `out` and its threat objects', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    placeRival(w, 1, v(8, 9));
    placeRival(w, 2, v(8, -3));
    const out: Threat[] = [];
    const r1 = findThreats(w, out);
    expect(r1).toBe(out);
    const objs = [...out];
    placeRival(w, 1, v(8, 2)); // order flips
    const r2 = findThreats(w, out);
    expect(r2).toBe(out);
    expect(out.map((t) => t.id)).toEqual([1, 2]);
    expect(new Set(out)).toEqual(new Set(objs));
    w.players[1].alive = false;
    w.players[2].alive = false;
    expect(findThreats(w, out)).toBe(out);
    expect(out.length).toBe(0);
  });
});

describe('threat alert', () => {
  const threat = (id: number, dist: number): Threat =>
    ({ id, colorIndex: id, dist, pos: v(0, 0), trailPoint: v(0, 0), trailS: 0 });

  it('blips when a rival becomes the closest threat under 8 u', () => {
    const a = createThreatAlert();
    expect(ALERT_DIST).toBe(8);
    expect(tickThreatAlert(a, [threat(1, 9)], 0.1)).toBe(false);
    expect(tickThreatAlert(a, [threat(1, 7.5)], 0.1)).toBe(true);
    expect(tickThreatAlert(a, [threat(1, 6)], 0.1)).toBe(false); // still the same one
  });

  it('blips again for a different rival taking over', () => {
    const a = createThreatAlert();
    expect(tickThreatAlert(a, [threat(1, 7)], 0.1)).toBe(true);
    expect(tickThreatAlert(a, [threat(2, 5), threat(1, 7)], 0.1)).toBe(true);
  });

  it('waits out a 2 s cooldown per rival', () => {
    const a = createThreatAlert();
    expect(ALERT_COOLDOWN_S).toBe(2);
    expect(tickThreatAlert(a, [threat(1, 7)], 0.1)).toBe(true);
    expect(tickThreatAlert(a, [threat(2, 6), threat(1, 7)], 0.5)).toBe(true);
    // Rival 1 is closest again 1 s after its blip: too soon.
    expect(tickThreatAlert(a, [threat(1, 5), threat(2, 6)], 0.5)).toBe(false);
    expect(tickThreatAlert(a, [], 0.5)).toBe(false);
    // 2.1 s after its blip it may blip again.
    expect(tickThreatAlert(a, [threat(1, 5)], 0.6)).toBe(true);
  });

  it('stays quiet with no threats', () => {
    const a = createThreatAlert();
    expect(tickThreatAlert(a, [], 1)).toBe(false);
  });
});

describe('threatGlowAlpha', () => {
  it('is 0.6·(1 − dist/10), clamped', async () => {
    const { threatGlowAlpha } = await import('../src/game/render');
    expect(threatGlowAlpha(0)).toBeCloseTo(0.6, 9);
    expect(threatGlowAlpha(5)).toBeCloseTo(0.3, 9);
    expect(threatGlowAlpha(10)).toBe(0);
    expect(threatGlowAlpha(14)).toBe(0);
  });
});
