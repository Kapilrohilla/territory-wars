import { describe, expect, it } from 'vitest';
import { maxDistFrom, waveRadius, waveSeconds, WAVE_MAX_S, WAVE_MIN_S } from '../src/game/waves';

describe('waveSeconds', () => {
  it('is 0.35 s for a tiny area and grows with sqrt(area)', () => {
    expect(waveSeconds(0)).toBeCloseTo(0.35, 9);
    expect(waveSeconds(100)).toBeCloseTo(0.35 + 0.012 * 10, 9);
  });

  it('is clamped to [0.35, 0.9]', () => {
    expect(WAVE_MIN_S).toBe(0.35);
    expect(WAVE_MAX_S).toBe(0.9);
    expect(waveSeconds(-50)).toBe(0.35);
    expect(waveSeconds(1e9)).toBe(0.9);
    expect(waveSeconds(Number.NaN)).toBe(0.35);
  });

  it('is monotonic in area', () => {
    let prev = -Infinity;
    for (let a = 0; a <= 10000; a += 37) {
      const s = waveSeconds(a);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(0.35);
      expect(s).toBeLessThanOrEqual(0.9);
      prev = s;
    }
  });
});

describe('waveRadius', () => {
  it('is 0 at t=0 and maxDist at the wave length (and after)', () => {
    expect(waveRadius(0, 0.5, 12)).toBe(0);
    expect(waveRadius(0.5, 0.5, 12)).toBeCloseTo(12, 9);
    expect(waveRadius(2, 0.5, 12)).toBeCloseTo(12, 9);
    expect(waveRadius(-1, 0.5, 12)).toBe(0);
  });

  it('follows easeOutCubic in between and is monotonic', () => {
    expect(waveRadius(0.25, 0.5, 10)).toBeCloseTo(10 * (1 - 0.5 ** 3), 9);
    let prev = -1;
    for (let t = 0; t <= 0.6; t += 0.01) {
      const r = waveRadius(t, 0.5, 10);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});

describe('maxDistFrom', () => {
  it('is the farthest region vertex from the origin', () => {
    const sq = [[[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]]];
    expect(maxDistFrom(sq, { x: 0, y: 0 })).toBeCloseTo(5, 9);
    expect(maxDistFrom(sq, { x: 2, y: 1.5 })).toBeCloseTo(2.5, 9);
    expect(maxDistFrom([], { x: 0, y: 0 })).toBe(0);
  });
});
