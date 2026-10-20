import { describe, it, expect } from 'vitest';
import {
  landArea, landContains, thickTrail, captureLand, subtractLand, keepPiece,
} from '../src/sim/territory';
import type { MultiPoly, Vec } from '../src/sim/geometry';

const rect = (x0: number, y0: number, x1: number, y1: number): MultiPoly => [[[
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
]]];
const v = (x: number, y: number): Vec => ({ x, y });

describe('territory', () => {
  it('captures square loop', () => {
    const own = rect(0, 0, 10, 10);
    const trail = [v(10, 5), v(15, 5), v(15, 15), v(5, 15), v(5, 9)];
    const a = landArea(captureLand(own, trail));
    expect(a).toBeGreaterThanOrEqual(175 - 3);
    expect(a).toBeLessThanOrEqual(175 + 12); // trail thickness adds a margin
    expect(landContains(captureLand(own, trail), v(12, 12))).toBe(true);
  });

  it('captures C-shaped enclosure', () => {
    // C: outer 0..10 x 0..10 with mouth cut x 4..10, y 4..6 -> hole region open to right
    const c: MultiPoly = [[[
      v(0, 0), v(10, 0), v(10, 4), v(4, 4), v(4, 6), v(10, 6), v(10, 10), v(0, 10),
    ]]];
    const before = landArea(c);
    // trail closes the mouth across x=10 (from (10,3) round to (10,7))
    const trail = [v(9, 3), v(10.5, 3), v(10.5, 7), v(9, 7)];
    const res = captureLand(c, trail);
    expect(res.length).toBe(1);
    expect(res[0].length).toBe(1);
    const mouth = 6 * 2; // x 4..10, y 4..6
    expect(landArea(res) - before).toBeGreaterThanOrEqual(mouth * 0.95);
    expect(landArea(res) - before).toBeLessThanOrEqual(mouth * 1.05 + 4);
  });

  it('tiny trail does not shrink land', () => {
    const own = rect(0, 0, 10, 10);
    const a = landArea(captureLand(own, [v(10, 5), v(9.9, 5)]));
    expect(a).toBeGreaterThanOrEqual(100 - 1e-6);
  });

  it('degenerate trail does not throw', () => {
    const own = rect(0, 0, 10, 10);
    expect(() => captureLand(own, [v(3, 3), v(3, 3), v(3, 3)])).not.toThrow();
    expect(landArea(captureLand(own, [v(3, 3), v(3, 3), v(3, 3)]))).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(thickTrail([v(1, 1), v(1, 1)], 0.6).length).toBeGreaterThanOrEqual(0);
  });

  it('subtractLand removes overlap', () => {
    const r = subtractLand(rect(0, 0, 10, 10), rect(5, 5, 15, 15));
    expect(landArea(r)).toBeCloseTo(75, 5);
    expect(landArea(subtractLand(rect(0, 0, 10, 10), rect(0, 0, 5, 5)))).toBeCloseTo(75, 5);
  });

  it('enemy split keeps head piece', () => {
    const bar = rect(0, 0, 20, 4);
    const split = subtractLand(bar, rect(9, -1, 11, 5));
    expect(split.length).toBe(2);
    const kept = keepPiece(split, v(15, 2));
    expect(kept.length).toBe(1);
    expect(landArea(kept)).toBeCloseTo(9 * 4, 5);
    expect(landContains(kept, v(15, 2))).toBe(true);
  });

  it('enemy out on trail keeps nearest piece', () => {
    const split = subtractLand(rect(0, 0, 20, 4), rect(9, -1, 11, 5));
    const kept = keepPiece(split, v(7, 8));
    expect(kept.length).toBe(1);
    expect(landContains(kept, v(4, 2))).toBe(true);
  });

  it('keepPiece of empty is empty', () => {
    expect(keepPiece([], v(0, 0))).toEqual([]);
  });
});
