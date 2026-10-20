import { describe, expect, it } from 'vitest';
import { BEST_KEY, isBetter, loadBest, recordRun } from '../src/ui/best';
import { minimapTransform } from '../src/game/minimap';

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('best score', () => {
  it('first non-zero run is a best; zero run is not', () => {
    expect(isBetter({ pct: 0, kills: 0, time: 3 }, null)).toBe(false);
    expect(isBetter({ pct: 0.5, kills: 0, time: 3 }, null)).toBe(true);
  });

  it('compares by pct, then kills', () => {
    const best = { pct: 10, kills: 2, time: 60 };
    expect(isBetter({ pct: 10.01, kills: 0, time: 1 }, best)).toBe(true);
    expect(isBetter({ pct: 9.99, kills: 9, time: 1 }, best)).toBe(false);
    expect(isBetter({ pct: 10, kills: 3, time: 1 }, best)).toBe(true);
    expect(isBetter({ pct: 10, kills: 2, time: 99 }, best)).toBe(false);
  });

  it('recordRun saves only new bests and loadBest reads them back', () => {
    const s = memStore();
    expect(recordRun({ pct: 5, kills: 1, time: 30 }, s)).toBe(true);
    expect(recordRun({ pct: 4, kills: 9, time: 90 }, s)).toBe(false);
    expect(loadBest(s)).toEqual({ pct: 5, kills: 1, time: 30 });
  });

  it('ignores corrupt or missing storage', () => {
    expect(loadBest(memStore({ [BEST_KEY]: '{oops' }))).toBeNull();
    expect(loadBest(memStore({ [BEST_KEY]: '{"pct":"x","kills":1,"time":1}' }))).toBeNull();
    expect(loadBest(undefined)).toBeNull();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadBest(throwing)).toBeNull();
    expect(recordRun({ pct: 1, kills: 0, time: 1 }, throwing)).toBe(true);
  });
});

describe('minimap transform', () => {
  it('fits the arena inside the map with padding', () => {
    const t = minimapTransform(160, 100, 4);
    expect(t.offset).toBe(80);
    expect(t.scale).toBeCloseTo(0.76);
    // arena edge lands 4px inside the map edge
    expect(t.offset + 100 * t.scale).toBeCloseTo(156);
  });
});
