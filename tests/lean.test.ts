import { describe, expect, it } from 'vitest';
import {
  LEAN_MAX, SQUASH, createLeanState, leanPose, smoothFactor, stepLean,
} from '../src/game/lean';

describe('leanPose', () => {
  it('is neutral when not turning', () => {
    const p = leanPose(0);
    expect(p.lean).toBe(0);
    expect(p.k).toBe(0);
    expect(p.sx).toBe(1);
    expect(p.sy).toBe(1);
  });
  it('leans by turnRate·0.06 and squashes by k = |turnRate|/6', () => {
    const p = leanPose(3);
    expect(p.lean).toBeCloseTo(0.18);
    expect(p.k).toBeCloseTo(0.5);
    expect(p.sx).toBeCloseTo(1 + 0.12 * 0.5);
    expect(p.sy).toBeCloseTo(1 - 0.12 * 0.5);
  });
  it('is clamped', () => {
    for (const r of [7, 50, 1e6, Infinity]) {
      const p = leanPose(r);
      expect(p.lean).toBe(LEAN_MAX);
      expect(p.k).toBe(1);
      expect(p.sx).toBeCloseTo(1 + SQUASH);
      expect(p.sy).toBeCloseTo(1 - SQUASH);
    }
    expect(leanPose(-1e6).lean).toBe(-LEAN_MAX);
    expect(LEAN_MAX).toBe(0.35);
  });
  it('is symmetric: a left turn mirrors a right turn', () => {
    for (const r of [0.5, 2, 4, 6, 9]) {
      const a = leanPose(r), b = leanPose(-r);
      expect(b.lean).toBeCloseTo(-a.lean);
      expect(b.k).toBeCloseTo(a.k);
      expect(b.sx).toBeCloseTo(a.sx);
      expect(b.sy).toBeCloseTo(a.sy);
    }
  });
  it('reuses the out object', () => {
    const out = { lean: 0, k: 0, sx: 1, sy: 1 };
    expect(leanPose(2, out)).toBe(out);
  });
  it('treats NaN as no turn', () => {
    expect(leanPose(NaN).lean).toBe(0);
  });
});

describe('smoothFactor', () => {
  it('is 1 − exp(−12·dt)', () => {
    expect(smoothFactor(0.016)).toBeCloseTo(1 - Math.exp(-12 * 0.016));
    expect(smoothFactor(0)).toBe(0);
  });
  it('stays in [0, 1) and grows with dt', () => {
    expect(smoothFactor(-1)).toBe(0);
    expect(smoothFactor(0.01)).toBeLessThan(smoothFactor(0.05));
    expect(smoothFactor(10)).toBeLessThanOrEqual(1);
  });
});

describe('stepLean', () => {
  it('first sight sets the heading without leaning', () => {
    const s = createLeanState();
    stepLean(s, 1.2, 1 / 60);
    expect(s.lean).toBe(0);
    expect(s.k).toBe(0);
  });
  it('eases toward the target pose, not snapping', () => {
    const s = createLeanState();
    stepLean(s, 0, 1 / 60);
    stepLean(s, 0.05, 1 / 60); // 3 rad/s
    expect(s.lean).toBeGreaterThan(0);
    expect(s.lean).toBeLessThan(0.18);
    for (let i = 2; i < 120; i++) stepLean(s, 0.05 * i, 1 / 60);
    expect(s.lean).toBeCloseTo(0.18, 3);
    expect(s.k).toBeCloseTo(0.5, 3);
  });
  it('ignores a zero or negative dt (resize repaint) and clamps long frames', () => {
    const s = createLeanState();
    stepLean(s, 0, 1 / 60);
    stepLean(s, 0.5, 0);
    expect(s.lean).toBe(0);
    stepLean(s, 0.5, -1);
    expect(s.lean).toBe(0);
    // A frame after a pause: the clamped dt cannot fully snap to the target.
    stepLean(s, 0.6, 5);
    expect(s.lean).toBeLessThan(LEAN_MAX);
  });
  it('treats a teleport (huge jump in one frame) as no turn', () => {
    const s = createLeanState();
    stepLean(s, 0, 1 / 60);
    stepLean(s, Math.PI, 1 / 60);
    expect(s.lean).toBe(0);
    expect(s.k).toBe(0);
  });
  it('mirrors for left and right turns', () => {
    const a = createLeanState(), b = createLeanState();
    for (let i = 0; i < 10; i++) {
      stepLean(a, 0.04 * i, 1 / 60);
      stepLean(b, -0.04 * i, 1 / 60);
    }
    expect(b.lean).toBeCloseTo(-a.lean);
    expect(b.k).toBeCloseTo(a.k);
  });
});
