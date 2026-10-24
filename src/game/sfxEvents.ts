import type { GameEvent, World } from '../sim/types';
import { pct } from '../sim/world';
import { landArea } from '../sim/territory';
import { waveSeconds } from './waves';
import { MAX_STREAK, type SoundName, type SoundOpts } from './sound';

/** One sound to play, with its options (see playSound). */
export type Cue = { name: SoundName } & SoundOpts;

/** A follow-up kill within this many seconds of the previous one extends the streak. */
export const STREAK_WINDOW_S = 8;
/** Land shares (%) that earn a one-off fanfare the first time the human passes them. */
export const MILESTONES = [10, 25, 50];

/** Steal swipe first, then the capture chord, then the relief chime, then any fanfare. */
const CAPTURE_AFTER_STEAL_S = 0.07;
const ESCAPE_AFTER_CAPTURE_S = 0.12;
const MILESTONE_AFTER_CAPTURE_S = 0.28;

/**
 * What soundsFor remembers between steps for one round. Plain data, so a test can build
 * or inspect it; make a fresh one per round with createSfxState().
 */
export type SfxState = {
  /** Streak level of the last human kill (0 = a lone kill), and when it happened. */
  streak: number;
  lastKillAt: number | null;
  /** How many of MILESTONES the human has already passed this round. */
  milestones: number;
  /** The human's protectedUntil last time we looked: a rise means a revive. */
  protectedUntil: number;
  /** The revive shield is up and its end hasn't been sounded yet. */
  shielded: boolean;
};

export function createSfxState(): SfxState {
  return { streak: 0, lastKillAt: null, milestones: 0, protectedUntil: 0, shielded: false };
}

/**
 * Which sounds one sim step's events (or a revive / give-up call) should play, from the
 * human's point of view. Bot-vs-bot happenings stay silent so the soundscape stays
 * readable. At most one of each sound per step. Call it after every step, even one with
 * no events, so revive-shield edges are heard.
 */
export function soundsFor(events: GameEvent[], world: World, state: SfxState): Cue[] {
  const human = world.humanId;
  const h = world.players[human];
  const out = new Map<SoundName, Cue>();
  /** Where the human's own moments happen (a copy: the live position moves on). */
  const head = () => ({ x: h.pos.x, y: h.pos.y });
  /** The last rival the human knocked out this step: the kill is heard where it fell. */
  let victim: number | null = null;
  const add = (c: Cue) => { if (!out.has(c.name)) out.set(c.name, c); };

  // Revive shield: protectedUntil jumps forward at a revive, and the shield ends once
  // world time reaches it.
  if (h.protectedUntil > state.protectedUntil) {
    state.protectedUntil = h.protectedUntil;
    state.shielded = true;
    state.streak = 0;
    state.lastKillAt = null;
    add({ name: 'revive' });
  } else if (state.shielded && world.time >= h.protectedUntil) {
    state.shielded = false;
    if (h.alive) add({ name: 'shieldDown' });
  }

  let capturePct = 0;
  /** The largest region the human took this step: the capture sweep lasts as long as its wave. */
  let captureArea = 0;
  let stole = false;
  let kills = 0;
  for (const e of events) {
    switch (e.type) {
      case 'capture':
        if (e.playerId === human && e.gainedPct > 0) {
          capturePct += e.gainedPct;
          captureArea = Math.max(captureArea, landArea(e.region));
          if (e.stolen.length > 0) stole = true;
        }
        break;
      case 'absorb':
        // Taking a victim's land sounds like stealing it.
        if (e.playerId === human && e.gainedPct > 0) {
          capturePct += e.gainedPct;
          captureArea = Math.max(captureArea, landArea(e.region));
          stole = true;
        }
        break;
      case 'escape':
        if (e.playerId === human) add({ name: 'escape' });
        break;
      case 'cut':
        // The hit point is where the human's head crossed the trail.
        if (e.hitterId === human) add({ name: 'cut', at: head() });
        else if (e.victimId === human) add({ name: 'burning', at: head() });
        break;
      case 'death':
        // The human's own final death is covered by 'down' / 'gameover'.
        if (e.playerId !== human && e.killerId === human) {
          kills++;
          victim = e.playerId;
        }
        break;
      case 'down':
        add({ name: 'down' });
        break;
      case 'win':
        add({ name: 'win' });
        break;
      case 'gameover':
        add({ name: 'gameover' });
        break;
    }
  }

  if (kills > 0) {
    // Every kill counts toward the streak, but one step plays a single chirp at its peak.
    for (let i = 0; i < kills; i++) {
      const quick = state.lastKillAt !== null && world.time - state.lastKillAt <= STREAK_WINDOW_S + 1e-9;
      state.streak = quick ? Math.min(MAX_STREAK, state.streak + 1) : 0;
      state.lastKillAt = world.time;
    }
    const v = world.players[victim!].pos;
    add({ name: 'kill', streak: state.streak, at: { x: v.x, y: v.y } });
  }

  if (capturePct > 0) {
    const t0 = stole ? CAPTURE_AFTER_STEAL_S : 0;
    if (stole) add({ name: 'steal', at: head() });
    add({ name: 'capture', pct: capturePct, delay: t0, durationS: waveSeconds(captureArea), at: head() });
    const esc = out.get('escape');
    if (esc) {
      // Re-insert so the relief chime follows the chord.
      out.delete('escape');
      add({ ...esc, delay: t0 + ESCAPE_AFTER_CAPTURE_S });
    }
    // Only the highest milestone newly passed plays; the ones it skipped are spent too.
    const now = pct(world, human);
    let passed = state.milestones;
    while (passed < MILESTONES.length && now >= MILESTONES[passed]) passed++;
    if (passed > state.milestones) {
      state.milestones = passed;
      add({ name: 'milestone', tier: passed - 1, delay: t0 + MILESTONE_AFTER_CAPTURE_S });
    }
  }

  // A win or loss drowns out everything else in that step.
  for (const end of ['win', 'down', 'gameover'] as const) {
    const c = out.get(end);
    if (c) return [c];
  }
  return [...out.values()];
}
