import { describe, it, expect } from 'vitest';
import {
  DANGER_WARNINGS_KEY, burnProgress, createBurnCache, dangerLevel, dangerWarningsEnabled, homeTarget,
} from '../src/game/danger';
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

/** Puts the human out on a straight trail of length `len` along +x from the land edge. */
function outOnTrail(w: World, len: number): void {
  const h = w.players[w.humanId];
  h.trail = [];
  for (let s = 0; s < len; s += 1) h.trail.push(v(3 + s, 0));
  h.pos = v(3 + len, 0);
  h.prevPos = { ...h.pos };
}

function placeRival(w: World, pos: Vec): void {
  const b = w.players[1];
  b.alive = true;
  b.pos = { ...pos };
  b.prevPos = { ...pos };
}

describe('dangerLevel', () => {
  it('is 0 at home', () => {
    expect(dangerLevel(soloWorld())).toBe(0);
  });

  it('rises with trail length and saturates at 1', () => {
    const w = soloWorld();
    outOnTrail(w, 5);
    expect(dangerLevel(w)).toBe(0); // under 6 u of trail: no exposure yet
    outOnTrail(w, 23);
    expect(dangerLevel(w)).toBeCloseTo(0.5, 6); // (23 - 6) / 34
    outOnTrail(w, 30);
    expect(dangerLevel(w)).toBeGreaterThan(0.5);
    outOnTrail(w, 60);
    expect(dangerLevel(w)).toBe(1);
  });

  it('rises with a rival head near the trail', () => {
    const w = soloWorld();
    outOnTrail(w, 4); // exposure 0
    placeRival(w, v(5, 30));
    expect(dangerLevel(w)).toBe(0); // 30 u away
    placeRival(w, v(5, 5));
    expect(dangerLevel(w)).toBeCloseTo(1 - (5 - 3) / 12, 6); // 5 u above the trail
    placeRival(w, v(5, 2));
    expect(dangerLevel(w)).toBe(1); // within 3 u
  });

  it('ignores dead rivals', () => {
    const w = soloWorld();
    outOnTrail(w, 4);
    placeRival(w, v(5, 2));
    w.players[1].alive = false;
    expect(dangerLevel(w)).toBe(0);
  });

  it('is 0 while awaiting revive or dead', () => {
    const w = soloWorld();
    outOnTrail(w, 60);
    w.awaitingRevive = true;
    expect(dangerLevel(w)).toBe(0);
    w.awaitingRevive = false;
    w.players[w.humanId].alive = false;
    expect(dangerLevel(w)).toBe(0);
  });
});

describe('burnProgress', () => {
  const burn = (front: number) => ({ s0: 1, back: 1, front, killerId: 1, killerDeaths: 0 });

  it('is null when the trail is not burning', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    expect(burnProgress(w, createBurnCache())).toBeNull();
  });

  it('starts at 0 and climbs monotonically to 1 as the front advances', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    const h = w.players[w.humanId];
    const cache = createBurnCache();
    h.burn = burn(2);
    expect(burnProgress(w, cache)).toBeCloseTo(0, 6);
    let last = 0;
    for (let f = 3; f <= 20; f++) {
      h.burn.front = f;
      const p = burnProgress(w, cache)!;
      expect(p).toBeGreaterThan(last);
      last = p;
    }
    expect(last).toBeCloseTo(1, 6);
  });

  it('forgets the gap once the burn is out, so the next burn starts at 0', () => {
    const w = soloWorld();
    outOnTrail(w, 20);
    const h = w.players[w.humanId];
    const cache = createBurnCache();
    h.burn = burn(2);
    burnProgress(w, cache);
    h.burn.front = 15;
    expect(burnProgress(w, cache)).toBeGreaterThan(0.5);
    h.burn = null;
    expect(burnProgress(w, cache)).toBeNull();
    h.burn = burn(10);
    expect(burnProgress(w, cache)).toBeCloseTo(0, 6);
  });
});

describe('homeTarget', () => {
  it('is null at home', () => {
    expect(homeTarget(soloWorld())).toBeNull();
  });

  it('gives the nearest point of the outer ring and its distance when outside', () => {
    const w = soloWorld();
    outOnTrail(w, 7); // head at (10, 0)
    const t = homeTarget(w)!;
    expect(t).not.toBeNull();
    expect(t.dist).toBeCloseTo(7, 6);
    expect(t.point.x).toBeCloseTo(3, 6);
    expect(t.point.y).toBeCloseTo(0, 6);
  });

  it('measures to the outer ring, not a hole', () => {
    const w = soloWorld();
    const h = w.players[w.humanId];
    const sq = (s: number) => [v(-s, -s), v(s, -s), v(s, s), v(-s, s)];
    h.land = [[sq(10), sq(5)]]; // a 20×20 square with a 10×10 hole; the head sits in the hole
    h.pos = v(0, 0);
    h.trail = [v(0, -6), v(0, -1)];
    const t = homeTarget(w)!;
    expect(t.dist).toBeCloseTo(10, 6);
  });
});

describe('dangerWarningsEnabled', () => {
  const store = (m: Record<string, string>) => ({ getItem: (k: string) => m[k] ?? null });
  it('is on unless the flag is "0"', () => {
    expect(DANGER_WARNINGS_KEY).toBe('territory-wars.dangerWarnings');
    expect(dangerWarningsEnabled(store({}))).toBe(true);
    expect(dangerWarningsEnabled(store({ [DANGER_WARNINGS_KEY]: '1' }))).toBe(true);
    expect(dangerWarningsEnabled(store({ [DANGER_WARNINGS_KEY]: '0' }))).toBe(false);
  });
});
