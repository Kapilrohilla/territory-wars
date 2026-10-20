import type { GameEvent, Player, World } from '../sim/types';
import type { Mood } from './skins';

/** How long (world seconds) a triggered mood lasts before the face settles back to idle. */
export const MOOD_SECONDS: Record<'happy' | 'fierce', number> = { happy: 1.2, fierce: 1.6 };

/** Per-player timed moods for one round. Plain data; make a fresh one per round. */
export type MoodState = { timed: Map<number, { mood: Mood; until: number }> };

export function createMoodState(): MoodState {
  return { timed: new Map() };
}

/**
 * Updates timed moods from one step's events: closing a loop makes the player happy,
 * cutting a trail or knocking someone out makes it fierce. A kill outranks a capture
 * in the same step.
 */
export function moodEvents(events: readonly GameEvent[], world: World, state: MoodState): void {
  const set = (id: number, mood: 'happy' | 'fierce') => {
    const cur = state.timed.get(id);
    if (mood === 'happy' && cur?.mood === 'fierce' && cur.until > world.time) return;
    state.timed.set(id, { mood, until: world.time + MOOD_SECONDS[mood] });
  };
  for (const e of events) {
    if (e.type === 'capture' && e.gainedPct > 0) set(e.playerId, 'happy');
  }
  for (const e of events) {
    if (e.type === 'cut') set(e.hitterId, 'fierce');
    else if ((e.type === 'death' || e.type === 'down') && e.killerId !== null && e.killerId !== e.playerId) {
      set(e.killerId, 'fierce');
    }
  }
}

/**
 * A player's mood now. Being knocked out or burning always shows; otherwise the latest
 * timed mood until it runs out, then idle.
 */
export function moodOf(p: Pick<Player, 'id' | 'alive' | 'burn' | 'isHuman'>, world: Pick<World, 'time' | 'awaitingRevive'>, state: MoodState): Mood {
  if (!p.alive || (p.isHuman && world.awaitingRevive)) return 'ko';
  if (p.burn) return 'scared';
  const t = state.timed.get(p.id);
  return t && world.time < t.until ? t.mood : 'idle';
}
