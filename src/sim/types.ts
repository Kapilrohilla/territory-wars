import type { Difficulty } from './config';
import type { MultiPoly, Vec } from './geometry';

/** null keeps the current target. */
export type Input = { targetHeading: number | null };

export type Player = {
  id: number;
  name: string;
  colorIndex: number;
  isHuman: boolean;
  alive: boolean;
  pos: Vec;
  prevPos: Vec;
  heading: number;
  targetHeading: number;
  land: MultiPoly;
  trail: Vec[];
  kills: number;
  deathTime: number | null;
  respawnAt: number | null;
  dyingLand: MultiPoly | null;
  /**
   * Set while this player's trail burns after a rival hit it. Positions are path lengths
   * from trail[0] (see trailLength): s0 is the hit, back/front the two fronts spreading
   * from it. The range [back, front] is burnt and harmless. Null when not burning.
   */
  burn: Burn | null;
  /** World time until which this player can't be killed (after a revive); 0 = never protected. */
  protectedUntil: number;
};

export type Burn = { s0: number; back: number; front: number; killerId: number };

/**
 * What killed a player: a burn reaching the head ('trail'), crossing one's own trail
 * ('self'), a head-on collision ('headon'), or a rival's capture ('captured': head inside
 * the newly captured region, or all land taken).
 */
export type DeathCause = 'trail' | 'self' | 'headon' | 'captured';

export type GameEvent =
  | { type: 'capture'; playerId: number; gainedPct: number; region: MultiPoly }
  | { type: 'death'; playerId: number; killerId: number | null; cause: DeathCause }
  /** The human was knocked out but may still be revived (the world is frozen meanwhile). */
  | { type: 'down'; playerId: number; killerId: number | null; cause: DeathCause }
  | { type: 'win' }
  | { type: 'gameover' };

export type World = {
  time: number;
  players: Player[];
  humanId: number;
  events: GameEvent[];
  over: boolean;
  won: boolean;
  seed: number;
  difficulty: Difficulty;
  /** mulberry32 state; advanced by every world-owned random draw. */
  rngState: number;
  /** Revives the human has left this round. */
  revivesLeft: number;
  /** The human is knocked out and the revive offer is open: step() does nothing. */
  awaitingRevive: boolean;
  /** Who knocked the human out (null for a self-kill); set at the down. */
  downKillerId: number | null;
  /** How the human was knocked out; set at the down. */
  downCause: DeathCause | null;
};
