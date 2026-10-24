import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadBest, recordRun } from '../src/ui/best';
import {
  EMPTY_LIFETIME, loadAdUnlocks, loadLifetime, loadSkin, recordRevive, recordRound, saveAdUnlock, saveSkin,
} from '../src/ui/progress';
import { readChoice, readFlag, writeChoice, writeFlag } from '../src/ui/screens';
import { dangerWarningsEnabled } from '../src/game/danger';
import { impactEnabled } from '../src/game/impact';
import { DEFAULT_SKIN } from '../src/game/skins';

/**
 * Where site data is blocked, merely reading `globalThis.localStorage` throws a SecurityError.
 * None of the loaders may let that escape (it used to crash the game on start).
 */
describe('a localStorage getter that throws', () => {
  const g = globalThis as { localStorage?: unknown };
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: storage blocked'); },
    });
  });
  afterEach(() => {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete g.localStorage;
  });

  it('does not throw from loadBest / recordRun', () => {
    expect(loadBest('normal')).toBeNull();
    expect(recordRun({ pct: 3, kills: 1, time: 20 }, 'hard')).toBe(true);
  });

  it('does not throw from the progress loaders and savers', () => {
    expect(loadLifetime()).toEqual(EMPTY_LIFETIME);
    expect(recordRound({ kills: 2, pct: 5, won: false }).games).toBe(1);
    expect(recordRevive().revives).toBe(1);
    expect(loadAdUnlocks().size).toBe(0);
    expect(() => saveAdUnlock('x')).not.toThrow();
    expect(loadSkin(EMPTY_LIFETIME, new Set()).id).toBe(DEFAULT_SKIN);
    expect(() => saveSkin('x')).not.toThrow();
  });

  it('does not throw from readFlag / writeFlag / readChoice / writeChoice', () => {
    expect(readFlag('territory-wars.minimap', true)).toBe(true);
    expect(readFlag('territory-wars.reduced-motion', false)).toBe(false);
    expect(() => writeFlag('k', true)).not.toThrow();
    expect(readChoice('k', ['a', 'b'] as const, 'b')).toBe('b');
    expect(() => writeChoice('k', 'a')).not.toThrow();
  });

  it('the game flags stay on', () => {
    expect(dangerWarningsEnabled()).toBe(true);
    expect(impactEnabled()).toBe(true);
  });
});
