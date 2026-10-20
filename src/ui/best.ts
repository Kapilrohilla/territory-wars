/** Best run so far, kept in localStorage. */
export type BestScore = { pct: number; kills: number; time: number };

export const BEST_KEY = 'territory-wars.best';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

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

export function loadBest(store: Store | undefined = globalThis.localStorage): BestScore | null {
  try {
    const raw = store?.getItem(BEST_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? { pct: v.pct, kills: v.kills, time: v.time } : null;
  } catch {
    return null;
  }
}

/** Saves `run` if it beats the stored best. Returns true when it is a new best. */
export function recordRun(run: BestScore, store: Store | undefined = globalThis.localStorage): boolean {
  if (!isBetter(run, loadBest(store))) return false;
  try {
    store?.setItem(BEST_KEY, JSON.stringify(run));
  } catch { /* storage unavailable: still a new best for this screen */ }
  return true;
}
