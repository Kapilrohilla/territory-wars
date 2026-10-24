import { afterEach, describe, expect, it } from 'vitest';
import {
  DANGER_WARNINGS_KEY, DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME, MUSIC_VOLUME_KEY, DIRECTIONAL_KEY, IMPACT_KEY, SFX_VOLUME_KEY,
  getDangerWarnings, getDirectional, getImpact, getMusicVolume, getSfxVolume, readBool, safeStorage,
  setDangerWarnings, setDirectional, setImpact, setMusicVolume, setSfxVolume,
} from '../src/ui/settings';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const throwing = {
  getItem: (): string | null => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('SecurityError'); },
};

describe('settings keys', () => {
  it('uses the agreed storage keys', () => {
    expect(SFX_VOLUME_KEY).toBe('territory-wars.sfxVolume');
    expect(DIRECTIONAL_KEY).toBe('territory-wars.directional');
    expect(DANGER_WARNINGS_KEY).toBe('territory-wars.dangerWarnings');
    expect(IMPACT_KEY).toBe('territory-wars.impact');
  });
});

describe('settings getters fall back to defaults', () => {
  it('when storage is empty', () => {
    const s = mem();
    expect(getSfxVolume(s)).toBe(80);
    expect(DEFAULT_SFX_VOLUME).toBe(80);
    expect(getDirectional(s)).toBe(true);
    expect(getDangerWarnings(s)).toBe(true);
    expect(getImpact(s)).toBe(true);
  });

  it('when storage is missing', () => {
    expect(getSfxVolume(undefined)).toBe(80);
    expect(getDirectional(undefined)).toBe(true);
  });

  it('when values are corrupt', () => {
    expect(getSfxVolume(mem({ [SFX_VOLUME_KEY]: 'loud' }))).toBe(80);
    expect(getSfxVolume(mem({ [SFX_VOLUME_KEY]: '' }))).toBe(80);
    expect(getSfxVolume(mem({ [SFX_VOLUME_KEY]: 'NaN' }))).toBe(80);
    expect(getSfxVolume(mem({ [SFX_VOLUME_KEY]: '250' }))).toBe(100);
    expect(getSfxVolume(mem({ [SFX_VOLUME_KEY]: '-4' }))).toBe(0);
    expect(getSfxVolume(mem({ [SFX_VOLUME_KEY]: '42.6' }))).toBe(43);
    expect(getDirectional(mem({ [DIRECTIONAL_KEY]: 'garbage' }))).toBe(true);
    expect(readBool('k', false, mem({ k: 'yes' }))).toBe(false);
  });

  it('when storage access throws', () => {
    expect(getSfxVolume(throwing)).toBe(80);
    expect(getDirectional(throwing)).toBe(true);
    expect(getDangerWarnings(throwing)).toBe(true);
    expect(getImpact(throwing)).toBe(true);
  });

  it("flags are off only for '0'", () => {
    const s = mem({ [DIRECTIONAL_KEY]: '0', [DANGER_WARNINGS_KEY]: '0', [IMPACT_KEY]: '0', [SFX_VOLUME_KEY]: '0' });
    expect(getDirectional(s)).toBe(false);
    expect(getDangerWarnings(s)).toBe(false);
    expect(getImpact(s)).toBe(false);
    expect(getSfxVolume(s)).toBe(0);
  });
});

describe('settings setters', () => {
  it('round-trip', () => {
    const s = mem();
    setSfxVolume(35, s);
    setDirectional(false, s);
    setDangerWarnings(false, s);
    setImpact(false, s);
    expect(getSfxVolume(s)).toBe(35);
    expect(getDirectional(s)).toBe(false);
    expect(getDangerWarnings(s)).toBe(false);
    expect(getImpact(s)).toBe(false);
    setDirectional(true, s);
    expect(s.m.get(DIRECTIONAL_KEY)).toBe('1');
  });

  it('clamp the volume and never throw', () => {
    const s = mem();
    setSfxVolume(400, s);
    expect(getSfxVolume(s)).toBe(100);
    expect(() => setSfxVolume(10, throwing)).not.toThrow();
    expect(() => setImpact(false, throwing)).not.toThrow();
  });
});

describe('blocked localStorage (the getter itself throws)', () => {
  const g = globalThis as { localStorage?: unknown };
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete g.localStorage;
  });
  const block = () => Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError: storage blocked'); },
  });

  it('safeStorage returns undefined and nothing throws', () => {
    block();
    expect(safeStorage()).toBeUndefined();
    expect(getSfxVolume()).toBe(80);
    expect(getDirectional()).toBe(true);
    expect(getDangerWarnings()).toBe(true);
    expect(getImpact()).toBe(true);
    expect(() => { setSfxVolume(5); setDirectional(false); setDangerWarnings(false); setImpact(false); }).not.toThrow();
  });

  it('reads the real store when it is there', () => {
    const s = mem({ [IMPACT_KEY]: '0' });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => s });
    expect(safeStorage()).toBe(s);
    expect(getImpact()).toBe(false);
  });
});

describe('music volume', () => {
  it('defaults to 50, persists clamped and survives a throwing store', () => {
    expect(MUSIC_VOLUME_KEY).toBe('territory-wars.musicVolume');
    expect(DEFAULT_MUSIC_VOLUME).toBe(50);
    const s = mem();
    expect(getMusicVolume(s)).toBe(50);
    setMusicVolume(30, s);
    expect(s.m.get(MUSIC_VOLUME_KEY)).toBe('30');
    expect(getMusicVolume(s)).toBe(30);
    setMusicVolume(250, s);
    expect(getMusicVolume(s)).toBe(100);
    expect(getMusicVolume(mem({ [MUSIC_VOLUME_KEY]: 'loud' }))).toBe(50);
    expect(getMusicVolume(throwing)).toBe(50);
    expect(() => setMusicVolume(10, throwing)).not.toThrow();
  });
});
