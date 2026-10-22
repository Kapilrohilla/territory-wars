import { describe, it, expect } from 'vitest';
import {
  landArea, landContains, thickTrail, captureLand, subtractLand, keepPiece, mergeLand, cutLand,
} from '../src/sim/territory';
import type { MultiPoly, Vec } from '../src/sim/geometry';
import * as pc from 'polygon-clipping';
import { mulberry32 } from '../src/sim/rng';

const rect = (x0: number, y0: number, x1: number, y1: number): MultiPoly => [[[
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
]]];
const v = (x: number, y: number): Vec => ({ x, y });

/** Reference band: plain union of one quad per segment and a square per vertex (no simplification). */
function referenceCapture(own: MultiPoly, trail: Vec[], w = 0.6): number {
  const h = w / 2;
  type P = [number, number][][];
  const pieces: P[] = trail.map((p) => [[[p.x - h, p.y - h], [p.x + h, p.y - h], [p.x + h, p.y + h], [p.x - h, p.y + h]]]);
  for (let i = 0; i + 1 < trail.length; i++) {
    const a = trail[i], b = trail[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const nx = (-(b.y - a.y) / len) * h, ny = ((b.x - a.x) / len) * h;
    pieces.push([[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]]]);
  }
  const ownPc = own.map((poly) => poly.map((r) => r.map((q): [number, number] => [q.x, q.y])));
  const [first, ...rest] = pieces;
  const merged = pc.union(ownPc, pc.union(first, ...rest)).map((poly) => poly.slice(0, 1));
  const m: MultiPoly = merged.map((poly) => poly.map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y }))));
  return landArea(m);
}

/** Steering-like loop out of the square's east side and back: smooth turns plus some sharp zigzags. */
function randomLoop(seed: number): Vec[] {
  const rnd = mulberry32(seed);
  const out: Vec[] = [v(9.8, 3)];
  let p = v(10.2, 3), hd = 0;
  out.push(p);
  for (let i = 0; i < 160; i++) {
    const sharp = rnd() < 0.05 ? (rnd() - 0.5) * 2.5 : 0;
    hd += (rnd() - 0.5) * 0.25 + sharp + (i > 20 && i < 140 ? 0.02 : 0);
    p = v(p.x + Math.cos(hd) * 0.25, p.y + Math.sin(hd) * 0.25);
    if (p.x < 10.5) { p = v(10.5, p.y); hd = 0; }
    out.push(p);
  }
  // head home in a straight line to the square's east side
  const end = v(9.8, 8);
  const n = Math.ceil(Math.hypot(end.x - p.x, end.y - p.y) / 0.25);
  for (let k = 1; k <= n; k++) out.push(v(p.x + ((end.x - p.x) * k) / n, p.y + ((end.y - p.y) * k) / n));
  return out;
}

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

  it('filling a hole that holds an own island does not double count', () => {
    const sq = (x0: number, y0: number, x1: number, y1: number) => [v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1)];
    // Ring 0..20 with hole 5..15, plus an island 8..12 inside the hole.
    const own: MultiPoly = [[sq(0, 0, 20, 20), sq(5, 5, 15, 15)], [sq(8, 8, 12, 12)]];
    expect(landArea(own)).toBeCloseTo(400 - 100 + 16, 6);
    const trail = [v(19.5, 10), v(24, 10), v(24, 14), v(19.5, 14)];
    const res = captureLand(own, trail);
    expect(res.length).toBe(1);
    expect(res[0].length).toBe(1);
    const filledOuter = 400 + 4 * 4; // filled ring + the 4x4 bump
    expect(landArea(res)).toBeGreaterThanOrEqual(filledOuter - 1);
    expect(landArea(res)).toBeLessThanOrEqual(filledOuter + 6); // band margin, never +16 from the island
  });

  it('single-ring band matches the union-of-quads reference', () => {
    const own = rect(0, 0, 10, 10);
    for (let seed = 1; seed <= 12; seed++) {
      const trail = randomLoop(seed);
      const got = captureLand(own, trail);
      expect(landArea(got)).toBeGreaterThan(100 + 50); // the loop really was captured
      let ref: number | null = null;
      try {
        ref = referenceCapture(own, trail);
      } catch {
        // polygon-clipping cannot union the many overlapping reference pieces for some
        // trails (the old implementation silently lost those captures); nothing to compare.
      }
      if (ref !== null) {
        // RDP simplification at tolerance 0.15 can shift the band edge inwards by at most
        // that much along the trail; bevel joins lose a little more at sharp corners.
        let len = 0;
        for (let i = 1; i < trail.length; i++) len += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
        expect(Math.abs(landArea(got) - ref)).toBeLessThanOrEqual(0.15 * len);
      }
      expect(landArea(got)).toBeGreaterThanOrEqual(100 - 1e-6);
      // the band covers the trail itself
      const band = thickTrail(trail);
      for (const q of trail) expect(landContains(band, q)).toBe(true);
    }
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

describe('mergeLand / cutLand', () => {
  const sq = (x: number, y: number, s: number): MultiPoly => [[[v(x, y), v(x + s, y), v(x + s, y + s), v(x, y + s)]]];
  it('merges touching land into one piece and keeps a far island separate', () => {
    const one = mergeLand(sq(0, 0, 4), sq(4, 0, 4));
    expect(one).toHaveLength(1);
    expect(landArea(one)).toBeCloseTo(32);
    const two = mergeLand(sq(0, 0, 4), sq(20, 20, 2));
    expect(two).toHaveLength(2);
    expect(landArea(two)).toBeCloseTo(20);
  });
  it('a cut on the home piece keeps the far island', () => {
    const land = mergeLand(sq(0, 0, 4), sq(20, 20, 2));
    const out = cutLand(land, sq(2, -1, 6), v(1, 1));
    expect(landArea(out)).toBeCloseTo(8 + 4);
    expect(landContains(out, v(21, 21))).toBe(true);
  });
  it('a cut through an island keeps its larger fragment', () => {
    const land = mergeLand(sq(0, 0, 4), sq(20, 20, 4));
    const out = cutLand(land, rect(19, 21, 26, 21.5), v(1, 1));
    expect(landContains(out, v(1, 1))).toBe(true);
    expect(landContains(out, v(22, 23))).toBe(true); // the bigger part above the cut
    expect(landContains(out, v(22, 20.5))).toBe(false); // the sliver below is dropped
  });
});
