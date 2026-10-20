import { describe, it, expect } from 'vitest';
import { createWorld, step, pct } from '../src/sim/world';
import { createBrains, botInputs } from '../src/sim/bots';
import { mulberry32 } from '../src/sim/rng';
import { angleDiff, circleRing, type MultiPoly, type Vec } from '../src/sim/geometry';
import type { Input, World } from '../src/sim/types';

const v = (x: number, y: number): Vec => ({ x, y });
const disk = (c: Vec, r: number): MultiPoly => [[circleRing(c, r, 24)]];

function setup(seed: number, onlyBot1: boolean): World {
  const w = createWorld({ seed, humanName: 'Tester', humanColor: 0 });
  const h = w.players[w.humanId];
  h.pos = v(0, 0); h.prevPos = v(0, 0);
  if (onlyBot1) {
    for (const p of w.players) {
      if (p.isHuman || p.id === 1) continue;
      p.alive = false; p.land = []; p.trail = []; p.respawnAt = null;
    }
  }
  return w;
}

const idle = (w: World, bots: Map<number, Input>): Map<number, Input> => {
  const m = new Map(bots);
  m.set(w.humanId, { targetHeading: null });
  // Park the human at home: it stays put and never leaves its land.
  const h = w.players[w.humanId];
  h.pos = v(0, 0); h.prevPos = v(0, 0); h.trail = [];
  return m;
};

describe('bots', () => {
  it('bot leaves home and returns, capturing land', () => {
    const w = setup(1, true);
    const b = w.players[1];
    const brains = createBrains(w);
    const rng = mulberry32(5);
    const before = pct(w, 1);
    for (let i = 0; i < 60 * 20; i++) {
      step(w, idle(w, botInputs(w, brains, rng)));
      if (w.over) break;
    }
    expect(b.alive).toBe(true);
    expect(pct(w, 1)).toBeGreaterThan(before);
  });

  for (const seed of [1, 2, 3]) {
    it(`bots survive 60 s mostly (seed ${seed})`, () => {
      const w = setup(seed, false);
      const brains = createBrains(w);
      const rng = mulberry32(seed + 100);
      const selfKilled = new Set<number>();
      for (let i = 0; i < 60 * 60; i++) {
        step(w, idle(w, botInputs(w, brains, rng)));
        for (const e of w.events) {
          if (e.type === 'death' && e.playerId !== w.humanId && e.killerId === e.playerId) selfKilled.add(e.playerId);
          // sim reports self-kills as killerId null; count those too
          if (e.type === 'death' && e.playerId !== w.humanId && e.killerId === null) selfKilled.add(e.playerId);
        }
        if (w.over) break;
      }
      expect(12 - selfKilled.size).toBeGreaterThanOrEqual(8);
    }, 30_000); // 60 s of simulated play with 13 players: well past Vitest's 5 s default on slow machines
  }

  it('bot hunts nearby human trail', () => {
    const w = setup(1, true);
    const b = w.players[1];
    b.pos = v(-30, 0); b.prevPos = v(-30, 0); b.heading = 0; b.targetHeading = 0;
    b.land = disk(v(-30, 0), 3);
    const h = w.players[0];
    h.pos = v(-24, 6); h.prevPos = v(-24, 6);
    h.land = disk(v(-24, 12), 3);
    h.trail = [];
    for (let y = -6; y <= 6; y += 0.25) h.trail.push(v(-24, y));
    const brains = createBrains(w);
    const rng = mulberry32(3);
    const inp = botInputs(w, brains, rng);
    expect(brains.get(1)!.state).toBe('hunt');
    expect(Math.abs(angleDiff(inp.get(1)!.targetHeading!, 0))).toBeLessThan(0.5);
  });

  it('bot with a burning trail returns home instead of hunting', () => {
    const w = setup(1, true);
    const b = w.players[1];
    b.pos = v(-30, 0); b.prevPos = v(-30, 0); b.heading = 0; b.targetHeading = 0;
    b.land = disk(v(-40, 0), 3);
    b.trail = [];
    for (let y = 0; y > -5; y -= 0.25) b.trail.push(v(-37, y));
    for (let x = -37; x < -30; x += 0.25) b.trail.push(v(x, -5));
    for (let y = -5; y < 0; y += 0.25) b.trail.push(v(-30, y));
    b.burn = { s0: 2, back: 1, front: 3, killerId: 0 };
    // Same prey as the hunt test, right in front of the bot.
    const h = w.players[0];
    h.pos = v(-24, 6); h.prevPos = v(-24, 6);
    h.land = disk(v(-24, 12), 3);
    h.trail = [];
    for (let y = -6; y <= 6; y += 0.25) h.trail.push(v(-24, y));
    const brains = createBrains(w);
    brains.get(1)!.state = 'out';
    brains.get(1)!.waypoints = [v(-10, 0)];
    const inp = botInputs(w, brains, mulberry32(3));
    expect(brains.get(1)!.state).toBe('return');
    // Heads back west towards its own land.
    expect(Math.abs(angleDiff(inp.get(1)!.targetHeading!, Math.PI))).toBeLessThan(0.5);
  });

  it('bot avoids wall', () => {
    const w = setup(1, true);
    const b = w.players[1];
    b.pos = v(95, 0); b.prevPos = v(95, 0); b.heading = 0; b.targetHeading = 0;
    b.land = disk(v(95, 0), 3);
    const brains = createBrains(w);
    brains.get(1)!.state = 'out';
    brains.get(1)!.waypoints = [v(99, 0), v(90, 5)];
    const rng = mulberry32(3);
    for (let i = 0; i < 60; i++) step(w, idle(w, botInputs(w, brains, rng)));
    const r = Math.hypot(b.pos.x, b.pos.y);
    expect(Math.abs(angleDiff(b.targetHeading, Math.PI))).toBeLessThan(Math.PI / 2);
    expect(r).toBeLessThan(97);
  });
});
