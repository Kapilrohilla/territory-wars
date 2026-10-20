import { describe, it, expect } from 'vitest';
import { createWorld, step, pct, trailLength } from '../src/sim/world';
import type { Input, Player, World } from '../src/sim/types';
import { circleRing, type MultiPoly, type Vec } from '../src/sim/geometry';
import { landArea } from '../src/sim/territory';
import { CONFIG, DIFFICULTY } from '../src/sim/config';

const v = (x: number, y: number): Vec => ({ x, y });
const disk = (c: Vec, r: number, n = 24): MultiPoly => [[circleRing(c, r, n)]];
const NO_INPUT = new Map<number, Input>();

/** World with seed 1 and every bot removed from play (no respawn). */
function soloWorld(): World {
  const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 0 });
  for (const p of w.players) {
    if (p.isHuman) continue;
    p.alive = false;
    p.land = [];
    p.trail = [];
    p.respawnAt = null;
  }
  const h = w.players[w.humanId];
  h.heading = 0;
  h.targetHeading = 0;
  return w;
}

/** Revive bot 1 at a given place with its own land far away. */
function placeBot(w: World, pos: Vec, heading: number, landAt: Vec = v(40, 40), r = 3): Player {
  const b = w.players[1];
  b.alive = true;
  b.pos = { ...pos };
  b.prevPos = { ...pos };
  b.heading = heading;
  b.targetHeading = heading;
  b.land = disk(landAt, r);
  b.trail = [];
  b.respawnAt = null;
  b.deathTime = null;
  b.dyingLand = null;
  return b;
}

const steer = (h: number) => new Map<number, Input>([[0, { targetHeading: h }]]);

describe('difficulty', () => {
  it('bot counts are 8 / 12 / 14', () => {
    const counts = (['easy', 'normal', 'hard'] as const).map(
      (d) => createWorld({ seed: 1, humanName: 'T', humanColor: 0, difficulty: d }).players.length - 1);
    expect(counts).toEqual([8, 12, 14]);
  });

  it('defaults to normal and stores the difficulty', () => {
    expect(createWorld({ seed: 1, humanName: 'T', humanColor: 0 }).difficulty).toBe('normal');
    expect(createWorld({ seed: 1, humanName: 'T', humanColor: 0, difficulty: 'hard' }).difficulty).toBe('hard');
  });

  it('burn speed and bot turn rate follow the difficulty table', () => {
    expect(DIFFICULTY.normal.burnSpeed).toBe(CONFIG.BURN_SPEED);
    expect(DIFFICULTY.normal.botTurnRate).toBe(CONFIG.TURN_BOT);
    expect(DIFFICULTY.normal.botCount).toBe(CONFIG.BOT_COUNT);
    expect(DIFFICULTY.easy.burnSpeed).toBe(30);
    expect(DIFFICULTY.hard.burnSpeed).toBe(55);
  });
});

describe('world', () => {
  it('human moves at 10 u/s', () => {
    const w = soloWorld();
    for (let i = 0; i < 60; i++) step(w, NO_INPUT);
    const h = w.players[0];
    expect(h.pos.x).toBeGreaterThan(10 - 0.2);
    expect(h.pos.x).toBeLessThan(10 + 0.2);
    expect(Math.abs(h.pos.y)).toBeLessThan(1e-9);
  });

  it('turn eases, does not snap', () => {
    const w = soloWorld();
    step(w, steer(Math.PI / 2));
    const hd = w.players[0].heading;
    expect(hd).toBeGreaterThan(0);
    expect(hd).toBeLessThan(Math.PI / 2);
  });

  it('trail spacing 0.25', () => {
    const w = soloWorld();
    const h = w.players[0];
    let guard = 0;
    while (h.trail.length === 0 && guard++ < 1000) step(w, NO_INPUT);
    for (let i = 0; i < 60; i++) step(w, NO_INPUT);
    expect(h.trail.length).toBeGreaterThanOrEqual(35);
    expect(h.trail.length).toBeLessThanOrEqual(45);
    for (let i = 1; i < h.trail.length; i++) {
      const d = Math.hypot(h.trail[i].x - h.trail[i - 1].x, h.trail[i].y - h.trail[i - 1].y);
      expect(d).toBeCloseTo(0.25, 3);
    }
  });

  it('closing loop captures and emits event', () => {
    const w = soloWorld();
    const h = w.players[0];
    const before = landArea(h.land);
    let captured = false;
    for (let i = 0; i < 300 && !captured; i++) {
      const t = w.time;
      const target = t < 0.6 ? 0 : t < 1.2 ? Math.PI / 2 : t < 1.8 ? Math.PI : -Math.PI / 2;
      step(w, steer(target));
      if (w.events.some((e) => e.type === 'capture' && e.playerId === 0)) captured = true;
    }
    expect(captured).toBe(true);
    expect(h.alive).toBe(true);
    expect(landArea(h.land)).toBeGreaterThan(before + 10);
    expect(h.trail.length).toBe(0);
  });

  it('hitting enemy trail kills owner and credits killer', () => {
    const w = soloWorld();
    const b = placeBot(w, v(5, 6), Math.PI / 2);
    b.trail = [v(5, -5), v(5, 5)];
    let hitTick = -1, deathTick = -1;
    let death = null;
    for (let i = 0; i < 120 && !death; i++) {
      step(w, NO_INPUT);
      if (hitTick < 0 && b.burn) hitTick = i;
      death = w.events.find((e) => e.type === 'death') ?? null;
      if (death) deathTick = i;
    }
    expect(hitTick).toBeGreaterThanOrEqual(0);
    expect(deathTick).toBeGreaterThan(hitTick); // dies after the burn, not on the hit tick
    expect(death).toEqual({ type: 'death', playerId: 1, killerId: 0 });
    expect(b.alive).toBe(false);
    expect(b.trail.length).toBe(0);
    expect(b.burn).toBeNull();
    expect(w.players[0].alive).toBe(true);
    expect(w.players[0].kills).toBe(1);
  });

  it('trail hit starts a burn instead of killing', () => {
    const w = soloWorld();
    const b = placeBot(w, v(5, 6), Math.PI / 2);
    b.trail = [v(5, -5), v(5, 5)];
    for (let i = 0; i < 60 && !b.burn; i++) step(w, NO_INPUT);
    expect(b.burn).not.toBeNull();
    expect(b.alive).toBe(true);
    expect(b.burn!.killerId).toBe(0);
    expect(b.burn!.s0).toBeCloseTo(5, 0); // hit at y≈0, 5 u from trail[0]
    expect(b.burn!.back).toBeLessThanOrEqual(b.burn!.s0);
    expect(b.burn!.front).toBeGreaterThanOrEqual(b.burn!.s0);
    expect(w.events.some((e) => e.type === 'death')).toBe(false);
    expect(w.players[0].kills).toBe(0);
    expect(trailLength(b)).toBeGreaterThan(b.burn!.front);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('burn reaches head kills victim and credits killer', () => {
    const w = soloWorld();
    const b = placeBot(w, v(5, 6), Math.PI / 2);
    b.trail = [v(5, -5), v(5, 5)];
    for (let i = 0; i < 60 && !b.burn; i++) step(w, NO_INPUT);
    const burn = b.burn!;
    const gap = trailLength(b) - burn.front;
    const expected = gap / (CONFIG.BURN_SPEED - CONFIG.SPEED);
    const t0 = w.time;
    let death = null;
    for (let i = 0; i < 300 && !death; i++) {
      step(w, NO_INPUT);
      death = w.events.find((e) => e.type === 'death') ?? null;
      if (!death) {
        expect(b.alive).toBe(true);
        expect(b.burn!.front).toBeLessThan(trailLength(b));
        expect(b.burn!.back).toBeGreaterThanOrEqual(0);
      }
    }
    expect(death).toEqual({ type: 'death', playerId: 1, killerId: 0 });
    expect(Math.abs(w.time - t0 - expected)).toBeLessThan(3 * CONFIG.DT);
    expect(w.players[0].kills).toBe(1);
    expect(b.burn).toBeNull();
    // exactly one death event over the whole burn
    for (let i = 0; i < 10; i++) {
      step(w, NO_INPUT);
      expect(w.events.some((e) => e.type === 'death')).toBe(false);
    }
  });

  it('reaching home cancels burn and still captures', () => {
    const w = soloWorld();
    // Loop leaving home at (3.5, 12.5), down, across, and back up towards home at (5, 12).
    const b = placeBot(w, v(5, 6), Math.PI / 2, v(5, 15), 3);
    b.trail = [v(3.5, 12.5), v(3.5, -5), v(5, -5), v(5, 5)];
    const before = landArea(b.land);
    for (let i = 0; i < 60 && !b.burn; i++) step(w, NO_INPUT);
    expect(b.burn).not.toBeNull();
    let cap = false;
    for (let i = 0; i < 120 && !cap; i++) {
      step(w, NO_INPUT);
      cap = w.events.some((e) => e.type === 'capture' && e.playerId === 1);
    }
    expect(cap).toBe(true);
    expect(b.alive).toBe(true);
    expect(b.burn).toBeNull();
    expect(b.trail.length).toBe(0);
    expect(landArea(b.land)).toBeGreaterThan(before + 10); // full loop captured, burnt part included
    expect(w.players[0].alive).toBe(true); // crossing the still-unburnt x=5 leg was ignored
    expect(w.players[0].kills).toBe(0);
  });

  it('burnt section is harmless', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.heading = Math.PI; h.targetHeading = Math.PI; // keep the human away
    const b = placeBot(w, v(5, 41), Math.PI / 2);
    b.trail = [v(5, -20), v(5, 40)];
    b.burn = { s0: 20, back: 10, front: 30, killerId: 0 };
    const c = w.players[2];
    Object.assign(c, {
      alive: true, pos: v(3, 0), prevPos: v(3, 0), heading: 0, targetHeading: 0,
      land: disk(v(-40, -40), 3), trail: [], respawnAt: null, deathTime: null, dyingLand: null, burn: null,
    });
    for (let i = 0; i < 30; i++) {
      step(w, NO_INPUT);
      expect(w.events.some((e) => e.type === 'death')).toBe(false);
    }
    expect(c.pos.x).toBeGreaterThan(6); // crossed x = 5 at y = 0 (s = 20, burnt)
    expect(c.alive).toBe(true);
    expect(b.alive).toBe(true);
    expect(b.burn!.killerId).toBe(0);
    expect(c.kills).toBe(0);
  });

  it('own burning trail: burnt part is harmless, rest still kills instantly', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.heading = Math.PI; h.targetHeading = Math.PI;
    // Bot heads south across its own trail at y = 0, which lies in the burnt range.
    const b = placeBot(w, v(0, 2), -Math.PI / 2);
    b.trail = [v(-30, 0), v(30, 0), v(30, 20), v(0, 20)];
    b.trail.push(v(0, 2)); // live tail runs (0,20) → (0,2)
    b.pos = v(0, 1.9); b.prevPos = v(0, 2);
    b.burn = { s0: 30, back: 20, front: 40, killerId: 2 };
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(b.alive).toBe(true);
  });

  it('self trail kills self', () => {
    const w = soloWorld();
    const h = w.players[0];
    for (let i = 0; i < 400 && h.alive; i++) {
      const t = w.time;
      const target = t < 1 ? 0 : t < 1.5 ? Math.PI / 2 : t < 2 ? Math.PI : -Math.PI / 2;
      step(w, steer(target));
    }
    expect(h.alive).toBe(false);
    // died somewhere outside its own start land, crossing the eastbound trail
    expect(h.pos.x).toBeGreaterThan(3);
    expect(h.pos.y).toBeLessThan(0.5);
    expect(h.kills).toBe(0);
  });

  it('head-on smaller dies', () => {
    const w = soloWorld();
    const b = placeBot(w, v(0.6, 0), Math.PI, v(40, 40), 1);
    step(w, NO_INPUT);
    expect(b.alive).toBe(false);
    expect(w.players[0].alive).toBe(true);
    expect(w.events).toContainEqual({ type: 'death', playerId: 1, killerId: 0 });
  });

  it('head-on tie kills both', () => {
    const w = soloWorld();
    const b = placeBot(w, v(0.6, 0), Math.PI, v(40, 40), 3);
    step(w, NO_INPUT);
    expect(b.alive).toBe(false);
    expect(w.players[0].alive).toBe(false);
  });

  it('enemy head inside captured land dies', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.trail = [v(2.5, 0), v(8, 0), v(8, 8), v(0, 8), v(0, 3.2)];
    h.pos = v(0, 3.2);
    h.prevPos = v(0, 3.4);
    h.heading = -Math.PI / 2;
    h.targetHeading = -Math.PI / 2;
    const b = placeBot(w, v(5, 5), 0);
    let cap = false;
    for (let i = 0; i < 5 && !cap; i++) {
      step(w, NO_INPUT);
      cap = w.events.some((e) => e.type === 'capture');
    }
    expect(cap).toBe(true);
    expect(b.alive).toBe(false);
    expect(w.events).toContainEqual({ type: 'death', playerId: 1, killerId: 0 });
    expect(h.kills).toBe(1);
    const ev = w.events.find((e) => e.type === 'capture');
    expect(ev && ev.type === 'capture' && ev.gainedPct).toBeGreaterThan(0);
  });

  it('enemy on capturer old land survives a capture elsewhere; enemy in new region dies', () => {
    const w = soloWorld();
    const h = w.players[0];
    // Long strip of existing land reaching far west; the capture happens at its east end.
    h.land = [[[v(-40, -3), v(3, -3), v(3, 3), v(-40, 3)]]];
    h.trail = [v(2.5, 0), v(8, 0), v(8, 8), v(0, 8), v(0, 3.2)];
    h.pos = v(0, 3.2);
    h.prevPos = v(0, 3.4);
    h.heading = -Math.PI / 2;
    h.targetHeading = -Math.PI / 2;
    const onOld = placeBot(w, v(-30, 0), 0); // crossing the capturer's old land, far away
    const inNew = w.players[2];
    Object.assign(inNew, {
      alive: true, pos: v(5, 5), prevPos: v(5, 5), heading: 0, targetHeading: 0,
      land: disk(v(-40, 40), 3), trail: [], respawnAt: null, deathTime: null, dyingLand: null,
    });
    let cap = false;
    for (let i = 0; i < 5 && !cap; i++) {
      step(w, NO_INPUT);
      cap = w.events.some((e) => e.type === 'capture');
    }
    expect(cap).toBe(true);
    expect(onOld.alive).toBe(true);
    expect(inNew.alive).toBe(false);
    expect(w.events).toContainEqual({ type: 'death', playerId: 2, killerId: 0 });
  });

  it('capture subtracts land from enemies', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.trail = [v(2.5, 0), v(8, 0), v(8, 8), v(0, 8), v(0, 3.2)];
    h.pos = v(0, 3.2);
    h.prevPos = v(0, 3.4);
    h.heading = -Math.PI / 2;
    h.targetHeading = -Math.PI / 2;
    // bot land straddles the captured square; head outside it
    const b = placeBot(w, v(12, 4), 0, v(8, 4), 3);
    b.land = disk(v(8, 4), 3);
    const before = landArea(b.land);
    for (let i = 0; i < 5; i++) step(w, NO_INPUT);
    expect(b.alive).toBe(true);
    expect(landArea(b.land)).toBeLessThan(before * 0.7);
  });

  it('wall clamp keeps player inside and trail valid', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.pos = v(95, 0);
    h.prevPos = v(95, 0);
    h.heading = 0.3;
    h.targetHeading = 0.3;
    for (let i = 0; i < 180; i++) step(w, NO_INPUT);
    expect(Math.hypot(h.pos.x, h.pos.y)).toBeLessThanOrEqual(CONFIG.ARENA_R + 1e-6);
    for (const p of h.trail) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(CONFIG.ARENA_R + 1e-6);
    expect(h.trail.length).toBeGreaterThan(0);
    // Now head home: the wall-riding loop must capture, and the new land stays inside the arena.
    let captured = false;
    for (let i = 0; i < 60 * 20 && !captured && h.alive; i++) {
      step(w, steer(Math.atan2(-h.pos.y, -h.pos.x)));
      captured = w.events.some((e) => e.type === 'capture' && e.playerId === 0);
    }
    expect(captured).toBe(true);
    expect(h.alive).toBe(true);
    let maxR = 0;
    for (const poly of h.land) for (const ring of poly) for (const q of ring) maxR = Math.max(maxR, Math.hypot(q.x, q.y));
    expect(maxR).toBeLessThanOrEqual(CONFIG.ARENA_R + 1e-6);
    expect(maxR).toBeGreaterThan(CONFIG.ARENA_R - 0.1); // the band reached the wall and was clipped there
  });

  it('heading straight into the wall slides along it at full speed', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.pos = v(CONFIG.ARENA_R - 0.05, 0);
    h.prevPos = { ...h.pos };
    h.heading = 0; // straight outward
    h.targetHeading = 0;
    const start = { ...h.pos };
    let maxR = 0;
    for (let i = 0; i < 60; i++) {
      step(w, NO_INPUT);
      maxR = Math.max(maxR, Math.hypot(h.pos.x, h.pos.y));
    }
    expect(maxR).toBeLessThanOrEqual(CONFIG.ARENA_R + 1e-9);
    expect(Math.hypot(h.pos.x - start.x, h.pos.y - start.y)).toBeGreaterThanOrEqual(5);
    expect(h.alive).toBe(true);
  });

  it('pct of fresh human ≈ 0.09', () => {
    const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 0 });
    expect(Math.abs(pct(w, 0) - 0.09)).toBeLessThanOrEqual(0.01);
  });

  it('creates 12 bots spawned away from the human', () => {
    const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 3 });
    expect(w.players.length).toBe(1 + CONFIG.BOT_COUNT);
    expect(w.players[0].pos).toEqual(v(0, 0));
    expect(w.players[0].name).toBe('Tester');
    for (const p of w.players.slice(1)) {
      expect(p.isHuman).toBe(false);
      expect(p.alive).toBe(true);
      expect(Math.hypot(p.pos.x, p.pos.y)).toBeGreaterThanOrEqual(CONFIG.SPAWN_MIN_DIST);
      expect(p.colorIndex).not.toBe(3);
    }
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('is deterministic for a seed', () => {
    const a = createWorld({ seed: 7, humanName: 'A', humanColor: 0 });
    const b = createWorld({ seed: 7, humanName: 'A', humanColor: 0 });
    for (let i = 0; i < 120; i++) { step(a, NO_INPUT); step(b, NO_INPUT); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('bots respawn after 2 s', () => {
    const w = soloWorld();
    const b = placeBot(w, v(5, 6), Math.PI / 2);
    b.trail = [v(5, -5), v(5, 5)];
    const oldName = b.name;
    for (let i = 0; i < 60 && b.alive; i++) step(w, NO_INPUT);
    expect(b.alive).toBe(false);
    const t0 = b.deathTime!;
    expect(b.dyingLand).not.toBeNull();
    expect(b.land.length).toBe(0);
    // keep the human safe at home: circle inside own land is fine, just steer back
    while (w.time < t0 + CONFIG.DEATH_SHRINK_S + 0.05) step(w, NO_INPUT);
    expect(b.dyingLand).toBeNull();
    while (w.time < t0 + CONFIG.BOT_RESPAWN_S - 0.05) step(w, NO_INPUT);
    expect(b.alive).toBe(false);
    while (w.time < t0 + CONFIG.BOT_RESPAWN_S + 0.05) step(w, NO_INPUT);
    expect(b.alive).toBe(true);
    expect(b.land.length).toBeGreaterThan(0);
    expect(b.name).not.toBe(oldName);
    const h = w.players[0];
    expect(Math.hypot(b.pos.x - h.pos.x, b.pos.y - h.pos.y)).toBeGreaterThanOrEqual(CONFIG.SPAWN_MIN_DIST);
  });

  it('human death sets over and emits gameover', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.pos = v(10, 0.2);
    h.prevPos = v(10, 0.1);
    h.heading = Math.PI / 2;
    h.targetHeading = Math.PI / 2;
    h.trail = [v(2.5, 0), v(10, 0)];
    placeBot(w, v(6, 1), -Math.PI / 2);
    for (let i = 0; i < 60 && !w.over; i++) step(w, NO_INPUT);
    expect(h.alive).toBe(false);
    expect(w.over).toBe(true);
    expect(w.won).toBe(false);
    expect(w.events).toContainEqual({ type: 'death', playerId: 0, killerId: 1 });
    expect(w.events).toContainEqual({ type: 'gameover' });
    const t = w.time;
    step(w, NO_INPUT);
    expect(w.time).toBe(t);
  });

  it('win at 99.5%', () => {
    const w = soloWorld();
    w.players[0].land = disk(v(0, 0), CONFIG.ARENA_R, 360);
    step(w, NO_INPUT);
    expect(w.won).toBe(true);
    expect(w.over).toBe(true);
    expect(w.events).toContainEqual({ type: 'win' });
  });
});
