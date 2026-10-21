import { describe, it, expect } from 'vitest';
import {
  ACHIEVEMENTS, EMPTY_LIFETIME, isUnlocked, loadAdUnlocks, loadLifetime, loadSkin, newlyUnlocked,
  recordRevive, recordRound, saveAdUnlock, saveSkin,
} from '../src/ui/progress';
import { skinById } from '../src/game/skins';
import { skinState } from '../src/ui/skinsScreen';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

describe('lifetime stats', () => {
  it('starts empty and adds rounds and revives', () => {
    const s = mem();
    expect(loadLifetime(s)).toEqual(EMPTY_LIFETIME);
    recordRound({ kills: 3, pct: 12.5, won: false }, s);
    recordRevive(s);
    const l = recordRound({ kills: 6, pct: 4, won: true }, s);
    expect(l).toEqual({ games: 2, totalKills: 9, revives: 1, wins: 1, bestRoundKills: 6, bestPct: 12.5 });
    expect(loadLifetime(s)).toEqual(l);
  });

  it('survives corrupt or missing storage', () => {
    const s = mem();
    s.setItem('territory-wars.lifetime', '{"games":"x","totalKills":-4}');
    expect(loadLifetime(s)).toEqual(EMPTY_LIFETIME);
    s.setItem('territory-wars.lifetime', 'not json');
    expect(loadLifetime(s)).toEqual(EMPTY_LIFETIME);
    expect(loadLifetime(undefined)).toEqual(EMPTY_LIFETIME);
  });
});

describe('skin unlocks', () => {
  it('unlocks by kind', () => {
    const none = new Set<string>();
    expect(isUnlocked(skinById('classic'), EMPTY_LIFETIME, none)).toBe(true);
    expect(isUnlocked(skinById('cool'), EMPTY_LIFETIME, none)).toBe(false);
    expect(isUnlocked(skinById('cool'), EMPTY_LIFETIME, new Set(['cool']))).toBe(true);
    expect(isUnlocked(skinById('cyclops'), { ...EMPTY_LIFETIME, totalKills: 10 }, none)).toBe(true);
  });

  it('reports achievement progress, capped', () => {
    expect(ACHIEVEMENTS.kills10.progress({ ...EMPTY_LIFETIME, totalKills: 14 })).toBe('10/10');
    expect(ACHIEVEMENTS.pct25.progress({ ...EMPTY_LIFETIME, bestPct: 12.7 })).toBe('12/25%');
  });

  it('lists skins newly unlocked by a round', () => {
    const after = { ...EMPTY_LIFETIME, wins: 1, bestRoundKills: 5 };
    expect(newlyUnlocked(EMPTY_LIFETIME, after).map((s) => s.id).sort()).toEqual(['devil', 'royal']);
    expect(newlyUnlocked(after, after)).toEqual([]);
  });

  it('saves ad unlocks and the chosen skin, falling back when locked', () => {
    const s = mem();
    saveSkin('cool', s);
    expect(loadSkin(EMPTY_LIFETIME, loadAdUnlocks(s), s).id).toBe('classic');
    saveAdUnlock('cool', s);
    expect(loadSkin(EMPTY_LIFETIME, loadAdUnlocks(s), s).id).toBe('cool');
  });

  it('gives each grid card a state', () => {
    const view = { selected: 'classic', lifetime: EMPTY_LIFETIME, adUnlocks: new Set(['bot']) };
    expect(skinState(skinById('classic'), view)).toBe('equipped');
    expect(skinState(skinById('grumpy'), view)).toBe('unlocked');
    expect(skinState(skinById('bot'), view)).toBe('unlocked');
    expect(skinState(skinById('cool'), view)).toBe('ad');
    expect(skinState(skinById('royal'), view)).toBe('locked');
  });
});
