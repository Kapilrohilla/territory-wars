import { describe, it, expect } from 'vitest';
import {
  angleDiff, ringArea, polyArea, pointInPoly, segIntersect, distPointSeg,
  circleRing, clampToCircle, simplifyPolyline, type Ring,
} from '../src/sim/geometry';
import { mulberry32 } from '../src/sim/rng';
import { CONFIG } from '../src/sim/config';

const sq = (x0: number, y0: number, s: number): Ring => [
  { x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s },
];

describe('geometry', () => {
  it('angleDiff wraps', () => {
    expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2, 9);
    expect(angleDiff(Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 9);
    expect(angleDiff(0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 9);
  });
  it('areas', () => {
    expect(ringArea(sq(0, 0, 1))).toBeCloseTo(1, 9);
    expect(polyArea([sq(0, 0, 4), sq(1, 1, 2)])).toBeCloseTo(12, 9);
  });
  it('pointInPoly excludes holes', () => {
    const p = [sq(0, 0, 4), sq(1, 1, 2)];
    expect(pointInPoly({ x: 0.5, y: 0.5 }, p)).toBe(true);
    expect(pointInPoly({ x: 2, y: 2 }, p)).toBe(false);
    expect(pointInPoly({ x: 9, y: 9 }, p)).toBe(false);
  });
  it('segIntersect', () => {
    expect(segIntersect({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 })).toBe(true);
    expect(segIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });
  it('distPointSeg', () => {
    expect(distPointSeg({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(1, 9);
    expect(distPointSeg({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(3, 9);
  });
  it('circleRing', () => {
    const r = circleRing({ x: 0, y: 0 }, 3, 24);
    expect(r).toHaveLength(24);
    expect(Math.abs(ringArea(r) - Math.PI * 9) / (Math.PI * 9)).toBeLessThan(0.03);
  });
  it('clampToCircle', () => {
    const c = clampToCircle({ x: 200, y: 0 }, 100);
    expect(c.x).toBeCloseTo(100, 9);
    expect(c.y).toBeCloseTo(0, 9);
    expect(clampToCircle({ x: 1, y: 1 }, 100)).toEqual({ x: 1, y: 1 });
  });
  it('simplifyPolyline', () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPolyline(pts, 0.01)).toHaveLength(2);
  });
  it('mulberry32 deterministic', () => {
    const a = mulberry32(1), b = mulberry32(1);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('config', () => {
    expect(CONFIG.ARENA_R).toBe(100);
  });
});
