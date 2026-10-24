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
  /** Scales the bots' hunt ray lengths. Unused when smartHunt is on (Hard), which uses huntRadius instead. */
  huntRangeMul: number;
  /** A bot with a trail longer than this (u) stops hunting and heads home. */
  cautionTrail: number;
  /** Longest leg (u) of a bot's planned trip. */
  waypointMax: number;
  /** Speed (u/s) of each front of a burning trail. */
  burnSpeed: number;
  // Smarter bots (Hard only; off for easy and normal). Same speed and rules as the player.
  /** Hunt the human's trail near its head (cost distToBot + 0.6·path-from-head), cutting it ≥ 2 u behind the head; dodge the human's head (no head-ons). */
  smartHunt: boolean;
  /** With smartHunt: notice any human trail point this close (u), in any direction; 0 = off. */
  huntRadius: number;
  /** With smartHunt: at most this many bots hunt the human at once (re-picked every 0.5 s); 0 = no limit. */
  packSize: number;
  /** Chance (0..1) a new trip is a raid looping through the nearest edge of the human's land. */
  raidChance: number;
  /** An 'out' bot heads home when a rival head is nearer its trail than it is to its land. */
  safeReturn: boolean;
  /** Multiplies the waypoint spacing upper bound and the bots' max trail length (1 = off). */
  loopScale: number;
};

const NOT_SMART = { smartHunt: false, huntRadius: 0, packSize: 0, raidChance: 0, safeReturn: false, loopScale: 1 } as const;

/** Normal is the baseline (the CONFIG defaults); easy and hard scale around it. */
export const DIFFICULTY: Record<Difficulty, DifficultyTuning> = {
  easy: {
    botCount: 8, botTurnRate: 3, huntRangeMul: 0.5, cautionTrail: 18, waypointMax: 11, burnSpeed: 30,
    ...NOT_SMART,
  },
  normal: {
    botCount: CONFIG.BOT_COUNT, botTurnRate: CONFIG.TURN_BOT, huntRangeMul: 1,
    cautionTrail: 25, waypointMax: 15, burnSpeed: CONFIG.BURN_SPEED,
    ...NOT_SMART,
  },
  hard: {
    botCount: 14, botTurnRate: 6, huntRangeMul: 1.6, cautionTrail: 34, waypointMax: 20, burnSpeed: 55,
    smartHunt: true, huntRadius: 25, packSize: 3, raidChance: 0.25, safeReturn: true, loopScale: 1.35,
  },
};
