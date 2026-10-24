import { safeStorage } from './settings';
import { DEFAULT_SKIN, SKINS, skinById, type AchievementId, type Skin } from '../game/skins';

/** Lifetime career stats, kept in localStorage. */
export type Lifetime = {
  games: number;
  totalKills: number;
  revives: number;
  wins: number;
  /** Most kills in a single round. */
  bestRoundKills: number;
  /** Highest territory % reached in any round, any difficulty. */
  bestPct: number;
};

export const LIFETIME_KEY = 'territory-wars.lifetime';
export const SKIN_KEY = 'territory-wars.skin';
export const AD_UNLOCKS_KEY = 'territory-wars.skins.ad-unlocked';

type Store = Pick<Storage, 'getItem' | 'setItem'> | undefined;

export const EMPTY_LIFETIME: Lifetime = { games: 0, totalKills: 0, revives: 0, wins: 0, bestRoundKills: 0, bestPct: 0 };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function loadLifetime(store: Store = safeStorage()): Lifetime {
  try {
    const raw = store?.getItem(LIFETIME_KEY);
    if (!raw) return { ...EMPTY_LIFETIME };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      games: num(o.games), totalKills: num(o.totalKills), revives: num(o.revives),
      wins: num(o.wins), bestRoundKills: num(o.bestRoundKills), bestPct: num(o.bestPct),
    };
  } catch {
    return { ...EMPTY_LIFETIME };
  }
}

function saveLifetime(l: Lifetime, store: Store): void {
  try { store?.setItem(LIFETIME_KEY, JSON.stringify(l)); } catch { /* storage unavailable */ }
}

/** Adds a finished round to the lifetime stats and returns the new totals. */
export function recordRound(
  round: { kills: number; pct: number; won: boolean },
  store: Store = safeStorage(),
): Lifetime {
  const l = loadLifetime(store);
  const next: Lifetime = {
    games: l.games + 1,
    totalKills: l.totalKills + round.kills,
    revives: l.revives,
    wins: l.wins + (round.won ? 1 : 0),
    bestRoundKills: Math.max(l.bestRoundKills, round.kills),
    bestPct: Math.max(l.bestPct, round.pct),
  };
  saveLifetime(next, store);
  return next;
}

/** Counts one revive. */
export function recordRevive(store: Store = safeStorage()): Lifetime {
  const l = loadLifetime(store);
  const next = { ...l, revives: l.revives + 1 };
  saveLifetime(next, store);
  return next;
}

export type Achievement = { id: AchievementId; label: string; done(l: Lifetime): boolean; progress(l: Lifetime): string };

export const ACHIEVEMENTS: Record<AchievementId, Achievement> = {
  kills10: {
    id: 'kills10', label: '10 kills in total',
    done: (l) => l.totalKills >= 10, progress: (l) => `${Math.min(10, l.totalKills)}/10`,
  },
  roundKills5: {
    id: 'roundKills5', label: '5 kills in one round',
    done: (l) => l.bestRoundKills >= 5, progress: (l) => `${Math.min(5, l.bestRoundKills)}/5`,
  },
  pct25: {
    id: 'pct25', label: 'Own 25% of the arena',
    done: (l) => l.bestPct >= 25, progress: (l) => `${Math.min(25, Math.floor(l.bestPct))}/25%`,
  },
  revives3: {
    id: 'revives3', label: 'Revive 3 times',
    done: (l) => l.revives >= 3, progress: (l) => `${Math.min(3, l.revives)}/3`,
  },
  win: {
    id: 'win', label: 'Win a round',
    done: (l) => l.wins >= 1, progress: (l) => `${Math.min(1, l.wins)}/1`,
  },
};

export function loadAdUnlocks(store: Store = safeStorage()): Set<string> {
  try {
    const v: unknown = JSON.parse(store?.getItem(AD_UNLOCKS_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveAdUnlock(id: string, store: Store = safeStorage()): void {
  const s = loadAdUnlocks(store);
  s.add(id);
  try { store?.setItem(AD_UNLOCKS_KEY, JSON.stringify([...s])); } catch { /* storage unavailable */ }
}

export function isUnlocked(skin: Skin, lifetime: Lifetime, adUnlocks: ReadonlySet<string>): boolean {
  switch (skin.unlock.kind) {
    case 'free': return true;
    case 'ad': return adUnlocks.has(skin.id);
    case 'achievement': return ACHIEVEMENTS[skin.unlock.id].done(lifetime);
  }
}

/** The saved skin, falling back to the default when it is unknown or no longer unlocked. */
export function loadSkin(lifetime: Lifetime, adUnlocks: ReadonlySet<string>, store: Store = safeStorage()): Skin {
  let id: string | null = null;
  try { id = store?.getItem(SKIN_KEY) ?? null; } catch { /* storage unavailable */ }
  const s = skinById(id);
  return s.id === id && isUnlocked(s, lifetime, adUnlocks) ? s : skinById(DEFAULT_SKIN);
}

export function saveSkin(id: string, store: Store = safeStorage()): void {
  try { store?.setItem(SKIN_KEY, id); } catch { /* storage unavailable */ }
}

/** Skins newly unlocked by going from `before` to `after` (achievement skins only). */
export function newlyUnlocked(before: Lifetime, after: Lifetime): Skin[] {
  return SKINS.filter((s) => s.unlock.kind === 'achievement'
    && !ACHIEVEMENTS[s.unlock.id].done(before) && ACHIEVEMENTS[s.unlock.id].done(after));
}
