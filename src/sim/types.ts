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
};

export type Burn = { s0: number; back: number; front: number; killerId: number };

export type GameEvent =
  | { type: 'capture'; playerId: number; gainedPct: number; region: MultiPoly }
  | { type: 'death'; playerId: number; killerId: number | null }
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
  /** mulberry32 state; advanced by every world-owned random draw. */
  rngState: number;
};
