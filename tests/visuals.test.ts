import { describe, it, expect } from 'vitest';
import {
  ASH_FADE_LEN, SHIELD_FADE_S, ashAlpha, headAlpha, nearestPointOnLand, pointOnTrail,
  shieldAlpha, shieldFraction,
  roundedCorners, CORNER_R,
} from '../src/game/render';
import { createWorld } from '../src/sim/world';
import { CONFIG } from '../src/sim/config';
import type { MultiPoly } from '../src/sim/geometry';

const square = (x: number, y: number, s: number): MultiPoly => [[[
  { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
]]];

describe('nearestPointOnLand', () => {
  it('finds the nearest edge point of a square from outside', () => {
    const out = { x: NaN, y: NaN };
    expect(nearestPointOnLand(square(0, 0, 2), { x: 5, y: 1 }, out)).toBeCloseTo(3);
    expect(out).toEqual({ x: 2, y: 1 });
  });
  it('snaps to a corner when beyond it', () => {
    const out = { x: 0, y: 0 };
    expect(nearestPointOnLand(square(0, 0, 2), { x: 5, y: 6 }, out)).toBeCloseTo(5);
    expect(out.x).toBeCloseTo(2);
    expect(out.y).toBeCloseTo(2);
  });
  it('picks the closer of several pieces', () => {
    const out = { x: 0, y: 0 };
    const land = [...square(0, 0, 1), ...square(10, 0, 1)];
    expect(nearestPointOnLand(land, { x: 8, y: 0.5 }, out)).toBeCloseTo(2);
    expect(out.x).toBeCloseTo(10);
  });
  it('is Infinity for empty land and leaves out alone', () => {
    const out = { x: 7, y: 7 };
    expect(nearestPointOnLand([], { x: 0, y: 0 }, out)).toBe(Infinity);
    expect(out).toEqual({ x: 7, y: 7 });
  });
});

describe('pointOnTrail', () => {
  const trail = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
  it('walks path length along the trail and live tail', () => {
    expect(pointOnTrail(trail, { x: 4, y: 3 }, 2)).toEqual({ x: 2, y: 0 });
    expect(pointOnTrail(trail, { x: 4, y: 3 }, 5)).toEqual({ x: 4, y: 1 });
  });
  it('clamps past the head', () => {
    expect(pointOnTrail(trail, { x: 4, y: 3 }, 99)).toEqual({ x: 4, y: 3 });
  });
});

describe('shield', () => {
  it('ring drains from full to empty over the protection', () => {
    expect(shieldFraction(CONFIG.REVIVE_PROTECT_S)).toBe(1);
    expect(shieldFraction(CONFIG.REVIVE_PROTECT_S / 2)).toBeCloseTo(0.5);
    expect(shieldFraction(0)).toBe(0);
    expect(shieldFraction(-1)).toBe(0);
  });
  it('is fully visible until the last SHIELD_FADE_S, then fades out', () => {
    expect(shieldAlpha(1.5)).toBe(1);
    expect(shieldAlpha(SHIELD_FADE_S)).toBe(1);
    const mid = shieldAlpha(SHIELD_FADE_S / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(shieldAlpha(0)).toBe(0);
  });
  it('head blink is soft while protected and off under reduced motion', () => {
    const w = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const h = w.players[w.humanId];
    expect(headAlpha(w, h)).toBe(1);
    h.protectedUntil = w.time + 1;
    for (let t = 0; t < 1; t += 0.01) {
      w.time = t;
      expect(headAlpha(w, h)).toBeGreaterThanOrEqual(0.75);
    }
    expect(headAlpha(w, h, true)).toBe(1);
  });
});

describe('ashAlpha', () => {
  const s0 = 10, back = 2, front = 20;
  it('is 0 outside the burnt range', () => {
    expect(ashAlpha(1, s0, back, front)).toBe(0);
    expect(ashAlpha(21, s0, back, front)).toBe(0);
  });
  it('is darkest at each front and fades behind it', () => {
    expect(ashAlpha(front, s0, back, front)).toBe(1);
    expect(ashAlpha(back, s0, back, front)).toBe(1);
    expect(ashAlpha(front - ASH_FADE_LEN / 2, s0, back, front)).toBeCloseTo(0.5);
    expect(ashAlpha(s0, s0, back, front)).toBe(0); // the hit point burnt longest ago
  });
});

describe('roundedCorners', () => {
  const v = (x: number, y: number) => ({ x, y });
  it('caps the cut at CORNER_R on long edges, so a big square only gets soft corners', () => {
    const cs = roundedCorners([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    expect(cs[1].a).toEqual(v(10 - CORNER_R, 0));
    expect(cs[1].b).toEqual(v(10, CORNER_R));
  });
  it('cuts at most half an edge, so a fine polygon becomes a continuous curve', () => {
    const ring = Array.from({ length: 24 }, (_, i) => v(3 * Math.cos((i / 24) * Math.PI * 2), 3 * Math.sin((i / 24) * Math.PI * 2)));
    const cs = roundedCorners(ring);
    for (let i = 0; i < cs.length; i++) {
      const next = cs[(i + 1) % cs.length];
      // Each curve ends exactly where the next begins: no straight facets remain.
      expect(cs[i].b.x).toBeCloseTo(next.a.x, 9);
      expect(cs[i].b.y).toBeCloseTo(next.a.y, 9);
    }
  });
});
