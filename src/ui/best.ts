import type { Difficulty } from '../sim/config';

/** Best run so far (per difficulty), kept in localStorage. */
export type BestScore = { pct: number; kills: number; time: number };

/** Pre-difficulty key; its value is migrated into 'normal' once. */
export const BEST_KEY = 'territory-wars.best';

export const bestKey = (difficulty: Difficulty): string => `${BEST_KEY}.${difficulty}`;

type Store = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

/** A run beats the best on territory %, then kills as a tie-break. */
export function isBetter(run: BestScore, best: BestScore | null): boolean {
  if (!best) return run.pct > 0 || run.kills > 0;
  return run.pct > best.pct || (run.pct === best.pct && run.kills > best.kills);
}

function valid(v: unknown): v is BestScore {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return [o.pct, o.kills, o.time].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
}

/** Moves the legacy single best into 'normal', only if normal has none yet. Runs at most once. */
function migrateLegacy(store: Store | undefined): void {
  try {
    if (!store || store.getItem(bestKey('normal')) !== null) return;
    const legacy = store.getItem(BEST_KEY);
    if (legacy === null) return;
    if (valid(JSON.parse(legacy) as unknown)) store.setItem(bestKey('normal'), legacy);
    store.removeItem?.(BEST_KEY);
  } catch { /* storage unavailable or corrupt: nothing to migrate */ }
}

export function loadBest(
  difficulty: Difficulty,
  store: Store | undefined = globalThis.localStorage,
): BestScore | null {
  try {
    migrateLegacy(store);
    const raw = store?.getItem(bestKey(difficulty));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? { pct: v.pct, kills: v.kills, time: v.time } : null;
  } catch {
    return null;
  }
}

/** Saves `run` if it beats the stored best for `difficulty`. Returns true when it is a new best. */
export function recordRun(
  run: BestScore,
  difficulty: Difficulty,
  store: Store | undefined = globalThis.localStorage,
): boolean {
  if (!isBetter(run, loadBest(difficulty, store))) return false;
  try {
    store?.setItem(bestKey(difficulty), JSON.stringify(run));
  } catch { /* storage unavailable: still a new best for this screen */ }
  return true;
}
