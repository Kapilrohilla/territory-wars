import { describe, expect, it } from 'vitest';
import { BEST_KEY, bestKey, isBetter, loadBest, recordRun } from '../src/ui/best';
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
    expect(recordRun({ pct: 5, kills: 1, time: 30 }, 'normal', s)).toBe(true);
    expect(recordRun({ pct: 4, kills: 9, time: 90 }, 'normal', s)).toBe(false);
    expect(loadBest('normal', s)).toEqual({ pct: 5, kills: 1, time: 30 });
  });

  it('ignores corrupt or missing storage', () => {
    expect(loadBest('normal', memStore({ [bestKey('normal')]: '{oops' }))).toBeNull();
    expect(loadBest('normal', memStore({ [bestKey('normal')]: '{"pct":"x","kills":1,"time":1}' }))).toBeNull();
    expect(loadBest('normal', undefined)).toBeNull();
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadBest('normal', throwing)).toBeNull();
    expect(recordRun({ pct: 1, kills: 0, time: 1 }, 'normal', throwing)).toBe(true);
  });
});

describe('best score per difficulty', () => {
  it('keeps bests separately per difficulty', () => {
    const s = memStore();
    expect(recordRun({ pct: 5, kills: 1, time: 30 }, 'easy', s)).toBe(true);
    expect(recordRun({ pct: 2, kills: 0, time: 10 }, 'hard', s)).toBe(true);
    expect(loadBest('easy', s)).toEqual({ pct: 5, kills: 1, time: 30 });
    expect(loadBest('hard', s)).toEqual({ pct: 2, kills: 0, time: 10 });
    expect(loadBest('normal', s)).toBeNull();
    // a lower run on hard doesn't beat the easy best, nor vice versa
    expect(recordRun({ pct: 1, kills: 0, time: 5 }, 'hard', s)).toBe(false);
    expect(bestKey('hard')).toBe('territory-wars.best.hard');
  });

  it('migrates the legacy key into normal once', () => {
    const legacy = JSON.stringify({ pct: 7, kills: 3, time: 50 });
    const s = memStore({ [BEST_KEY]: legacy });
    expect(loadBest('easy', s)).toBeNull();
    expect(loadBest('normal', s)).toEqual({ pct: 7, kills: 3, time: 50 });
    expect(s.m.has(bestKey('normal'))).toBe(true);
    // a later (different) legacy value never overwrites the migrated one
    s.setItem(BEST_KEY, JSON.stringify({ pct: 99, kills: 9, time: 9 }));
    expect(loadBest('normal', s)).toEqual({ pct: 7, kills: 3, time: 50 });
  });

  it('does not migrate over an existing normal best', () => {
    const s = memStore({
      [BEST_KEY]: JSON.stringify({ pct: 7, kills: 3, time: 50 }),
      [bestKey('normal')]: JSON.stringify({ pct: 1, kills: 0, time: 5 }),
    });
    expect(loadBest('normal', s)).toEqual({ pct: 1, kills: 0, time: 5 });
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
