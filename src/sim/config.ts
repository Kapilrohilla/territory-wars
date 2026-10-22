export const CONFIG = {
  ARENA_R: 100,
  /** Captured land is clipped to an inscribed polygon with this many vertices. */
  ARENA_VERTS: 128,
  /** Players are kept this far inside the wall, so a player riding the wall on its own
   *  (clipped) land is still inside it: 100·(1 − cos(π/128)) ≈ 0.03 < 0.05. */
  WALL_PAD: 0.05,
  START_R: 3,
  START_VERTS: 24,
  SPEED: 10,
  TURN_HUMAN: 8,
  TURN_BOT: 4,
  TURN_DT_CAP: 0.04,
  DT: 1 / 60,
  TRAIL_STEP: 0.25,
  SELF_SAFE_LEN: 1.0,
  HEAD_ON_DIST: 1.0,
  /** Speed (u/s, along the trail's path length) of each front of a burning trail. */
  BURN_SPEED: 40,
  BOT_COUNT: 12,
  BOT_RESPAWN_S: 2,
  SPAWN_MIN_DIST: 20,
  SPAWN_RETRY_S: 1,
  DEATH_SHRINK_S: 0.5,
  /** After a revive the human can't be killed for this long (s). */
  REVIVE_PROTECT_S: 2,
  WIN_PCT: 99.5,
  ZOOM_MIN: 20,
  ZOOM_MAX: 30,
  ZOOM_FULL_PCT: 50,
} as const;

/** What happens when the human's head crosses its own trail: knocked out, or nothing. */
export type SelfCross = 'die' | 'pass';
export const SELF_CROSS_MODES: readonly SelfCross[] = ['die', 'pass'];

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export type DifficultyTuning = {
  botCount: number;
  /** Bot steering rate (like CONFIG.TURN_HUMAN). */
  botTurnRate: number;
  /** Scales the bots' hunt ray lengths. */
  huntRangeMul: number;
  /** A bot with a trail longer than this (u) stops hunting and heads home. */
  cautionTrail: number;
  /** Longest leg (u) of a bot's planned trip. */
  waypointMax: number;
  /** Speed (u/s) of each front of a burning trail. */
  burnSpeed: number;
};

/** Normal is the baseline (the CONFIG defaults); easy and hard scale around it. */
export const DIFFICULTY: Record<Difficulty, DifficultyTuning> = {
  easy: { botCount: 8, botTurnRate: 3, huntRangeMul: 0.5, cautionTrail: 18, waypointMax: 11, burnSpeed: 30 },
  normal: {
    botCount: CONFIG.BOT_COUNT, botTurnRate: CONFIG.TURN_BOT, huntRangeMul: 1,
    cautionTrail: 25, waypointMax: 15, burnSpeed: CONFIG.BURN_SPEED,
  },
  hard: { botCount: 14, botTurnRate: 6, huntRangeMul: 1.6, cautionTrail: 34, waypointMax: 20, burnSpeed: 55 },
};
