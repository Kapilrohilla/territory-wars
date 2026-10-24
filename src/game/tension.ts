/**
 * The tension layer: a heartbeat that quickens with danger, an ember crackle while the
 * human's trail burns, and a relief chime on getting home. Scheduling (tickTension) is pure
 * and driven by real time; createTension wires it to sound for one session.
 */
import { DANGER_SHOW, type DangerState } from './danger';
import { ESCAPE_AFTER_CAPTURE_S } from './sfxEvents';
import { playSound, type SoundName, type SoundOpts } from './sound';
import type { World } from '../sim/types';

/** Heartbeat starts at this danger (or whenever the trail burns). */
export const TENSION_MIN = DANGER_SHOW;
/** Burning vignette pulse rate. */
const BURN_VIGNETTE_HZ = 2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Seconds between heartbeats at a danger level. */
export const beatInterval = (danger: number) => 0.95 - 0.5 * clamp01(danger);
/** Heartbeat loudness at a danger level. */
export const beatGain = (danger: number) => 0.02 + 0.06 * clamp01(danger);
/** Seconds between crackle bursts at a burn progress. */
export const crackleInterval = (progress: number) => 0.22 - 0.12 * clamp01(progress);

/**
 * Burning-trail vignette opacity: 0.25 + 0.35·progress, pulsing at 2 Hz (dipping to 70 %
 * of that), steady under reduced motion.
 */
export function burnVignetteAlpha(progress: number, time: number, reduced: boolean): number {
  const strength = 0.25 + 0.35 * clamp01(progress);
  if (reduced) return strength;
  return strength * (0.85 + 0.15 * Math.cos(time * BURN_VIGNETTE_HZ * Math.PI * 2));
}

/** Countdown state for the heartbeat and crackle; `beat` / `crackle` say what is due this tick. */
export type TensionClock = { beatIn: number; crackleIn: number; beat: boolean; crackle: boolean };

export function createTensionClock(): TensionClock {
  return { beatIn: 0, crackleIn: 0, beat: false, crackle: false };
}

/**
 * Advances the clock by dt real seconds. Sets c.beat when a heartbeat is due (danger ≥
 * TENSION_MIN or burning) and c.crackle when a crackle is due (burning). At most one of
 * each per tick. The countdowns keep running while quiet, so danger flickering around the
 * threshold never beats faster than the interval.
 */
export function tickTension(c: TensionClock, danger: number, burn: number | null, dt: number): void {
  const burning = burn !== null;
  c.beat = false;
  c.crackle = false;

  c.beatIn -= dt;
  if (danger >= TENSION_MIN || burning) {
    if (c.beatIn <= 0) {
      c.beat = true;
      c.beatIn = Math.max(0, c.beatIn) + beatInterval(danger);
    }
  } else if (c.beatIn < 0) {
    c.beatIn = 0;
  }

  c.crackleIn -= dt;
  if (burning) {
    if (c.crackleIn <= 0) {
      c.crackle = true;
      c.crackleIn = Math.max(0, c.crackleIn) + crackleInterval(burn);
    }
  } else if (c.crackleIn < 0) {
    c.crackleIn = 0;
  }
}

export type Tension = {
  /** Call once per rendered frame with real elapsed seconds and this frame's danger sample. */
  update(world: World, dt: number, danger: DangerState): void;
  /**
   * Tell it a cue played from this step's events, with its delay (s): an 'escape' then
   * suppresses the relief chime, and a 'capture' pushes it after the chord, as sfxEvents does.
   */
  heard(name: SoundName, delay?: number): void;
  /** Stops scheduling for good. Beats already playing are one-shots and end on their own. */
  dispose(): void;
};

type Play = (name: SoundName, opts?: SoundOpts) => void;

export function createTension(play: Play = playSound): Tension {
  const clock = createTensionClock();
  const beatOpts: SoundOpts = { gain: 0 };
  const crackleOpts: SoundOpts = { level: 0 };
  /** Danger of the last update, to catch the drop to 0 on reaching home. */
  let prev = 0;
  let escapeHeard = false;
  /** Delay of a capture chord heard this step, or -1. */
  let captureAt = -1;
  const reliefOpts: SoundOpts = { delay: 0 };
  let disposed = false;

  return {
    update(world, dt, d) {
      if (disposed) return;
      const h = world.players[world.humanId];
      if (world.over || world.awaitingRevive || !h.alive) {
        // Silent: no heartbeat behind the revive offer or after the end.
        clock.beatIn = clock.crackleIn = 0;
        prev = 0;
        escapeHeard = false;
        captureAt = -1;
        return;
      }
      tickTension(clock, d.level, d.burn, dt);
      // With danger warnings off only the burn crackle remains.
      if (clock.beat && d.warnings) {
        beatOpts.gain = beatGain(d.burn !== null ? Math.max(d.level, TENSION_MIN) : d.level);
        play('heartbeat', beatOpts);
      }
      if (clock.crackle) {
        crackleOpts.level = d.burn ?? 0;
        play('crackle', crackleOpts);
      }
      // Relief: made it home from real danger (an escape chime this step already covers it).
      // After a capture chord this step, it follows the chord instead of clashing with it.
      if (d.warnings && prev >= TENSION_MIN && d.level === 0 && h.trail.length === 0 && !escapeHeard) {
        reliefOpts.delay = captureAt >= 0 ? captureAt + ESCAPE_AFTER_CAPTURE_S : 0;
        play('escape', reliefOpts);
      }
      prev = d.level;
      escapeHeard = false;
      captureAt = -1;
    },
    heard(name, delay = 0) {
      if (name === 'escape') escapeHeard = true;
      else if (name === 'capture') captureAt = delay;
    },
    dispose() {
      disposed = true;
    },
  };
}
