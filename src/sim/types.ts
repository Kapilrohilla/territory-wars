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
};

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
