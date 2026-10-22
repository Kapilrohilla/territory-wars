import { describe, it, expect } from 'vitest';
import { createWorld, declineRevive, reviveHuman, step, pct, trailLength } from '../src/sim/world';
import type { Input, Player, World } from '../src/sim/types';
import { circleRing, type MultiPoly, type Vec } from '../src/sim/geometry';
import { landArea, landContains } from '../src/sim/territory';
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
    expect(death).toEqual({ type: 'death', playerId: 1, killerId: 0, cause: 'trail' });
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

  it('a trail cut emits one cut event naming hitter and victim', () => {
    const w = soloWorld();
    const b = placeBot(w, v(5, 6), Math.PI / 2);
    b.trail = [v(5, -5), v(5, 5)];
    let cuts: unknown[] = [];
    for (let i = 0; i < 60 && !b.burn; i++) {
      step(w, NO_INPUT);
      cuts = w.events.filter((e) => e.type === 'cut');
    }
    expect(cuts).toEqual([{ type: 'cut', hitterId: 0, victimId: b.id }]);
    step(w, NO_INPUT); // already burning: no second cut
    expect(w.events.some((e) => e.type === 'cut')).toBe(false);
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
    expect(death).toEqual({ type: 'death', playerId: 1, killerId: 0, cause: 'trail' });
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
    b.burn = { s0: 20, back: 10, front: 30, killerId: 0, killerDeaths: 0 };
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
    b.burn = { s0: 30, back: 20, front: 40, killerId: 2, killerDeaths: 0 };
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(b.alive).toBe(true);
  });

  it('own burning trail: crossing an unburnt segment still kills instantly', () => {
    const w = soloWorld();
    const h = w.players[0];
    h.heading = Math.PI; h.targetHeading = Math.PI;
    // Same loop, but the burn sits on the (30,20)→(0,20) leg; the crossing at y = 0 (s = 30) is unburnt.
    const b = placeBot(w, v(0, 2), -Math.PI / 2);
    b.trail = [v(-30, 0), v(30, 0), v(30, 20), v(0, 20)];
    b.trail.push(v(0, 2));
    b.pos = v(0, 1.9); b.prevPos = v(0, 2);
    b.burn = { s0: 90, back: 85, front: 95, killerId: 2, killerDeaths: 0 };
    let ticks = 0, death = null;
    while (!death && ticks < 30) {
      step(w, NO_INPUT);
      ticks++;
      death = w.events.find((e) => e.type === 'death') ?? null;
    }
    expect(death).toEqual({ type: 'death', playerId: 1, killerId: null, cause: 'self' });
    // Instant: dies on the tick its head crosses y = 0 (1.9 u at 1/6 u per tick), not when a burn arrives.
    expect(ticks).toBeLessThanOrEqual(Math.ceil(1.9 / (CONFIG.SPEED * CONFIG.DT)) + 1);
  });

  describe('burn credit', () => {
    /** Bot 1 crosses the human's trail (head far up at y = 10), then bot 2 kills bot 1 head-on. */
    function burnThenKillHitter(w: World): Player {
      const h = w.players[0];
      h.pos = v(10, 10.2);
      h.prevPos = v(10, 10.1);
      h.heading = Math.PI / 2;
      h.targetHeading = Math.PI / 2;
      h.trail = [v(2.5, 0), v(10, 0), v(10, 10)];
      const b1 = placeBot(w, v(6, 1), -Math.PI / 2);
      for (let i = 0; i < 60 && !h.burn; i++) step(w, NO_INPUT);
      expect(h.burn?.killerId).toBe(1);
      const c = w.players[2];
      Object.assign(c, {
        alive: true, pos: v(b1.pos.x, b1.pos.y - 0.6), prevPos: v(b1.pos.x, b1.pos.y - 0.6),
        heading: Math.PI / 2, targetHeading: Math.PI / 2,
        land: disk(v(-40, -40), 8), trail: [], respawnAt: null, deathTime: null, dyingLand: null, burn: null,
      });
      step(w, NO_INPUT);
      expect(b1.alive).toBe(false);
      expect(h.alive).toBe(true);
      return b1;
    }

    const runToDown = (w: World) => {
      for (let i = 0; i < 120 && !w.awaitingRevive; i++) step(w, NO_INPUT);
      expect(w.awaitingRevive).toBe(true);
    };

    it('credits nobody when the hitter is dead when the burn arrives', () => {
      const w = soloWorld();
      const b1 = burnThenKillHitter(w);
      runToDown(w);
      expect(b1.alive).toBe(false);
      expect(w.events).toContainEqual({ type: 'down', playerId: 0, killerId: null, cause: 'trail' });
      expect(w.downKillerId).toBeNull();
      expect(b1.kills).toBe(0);
    });

    it('credits nobody when the hitter has respawned since the hit', () => {
      const w = soloWorld();
      const b1 = burnThenKillHitter(w);
      b1.respawnAt = w.time; // respawn on the next tick, well before the burn arrives
      step(w, NO_INPUT);
      expect(b1.alive).toBe(true);
      runToDown(w);
      expect(b1.alive).toBe(true);
      expect(w.events).toContainEqual({ type: 'down', playerId: 0, killerId: null, cause: 'trail' });
      expect(b1.kills).toBe(0);
    });
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
    expect(w.events).toContainEqual({ type: 'death', playerId: 1, killerId: 0, cause: 'headon' });
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
    expect(w.events).toContainEqual({ type: 'death', playerId: 1, killerId: 0, cause: 'captured' });
    expect(h.kills).toBe(1);
    const ev = w.events.find((e) => e.type === 'capture');
    expect(ev && ev.type === 'capture' && ev.gainedPct).toBeGreaterThan(0);
  });

  describe('capture event data', () => {
    /** The human closes a loop over [0, 8]² (see the capture tests above); returns its events. */
    function closeLoop(w: World): World['events'] {
      const h = w.players[0];
      h.trail = [v(2.5, 0), v(8, 0), v(8, 8), v(0, 8), v(0, 3.2)];
      h.pos = v(0, 3.2);
      h.prevPos = v(0, 3.4);
      h.heading = -Math.PI / 2;
      h.targetHeading = -Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        step(w, NO_INPUT);
        if (w.events.some((e) => e.type === 'capture')) return w.events;
      }
      throw new Error('no capture');
    }
    const captureOf = (events: World['events']) => {
      const e = events.find((x) => x.type === 'capture');
      if (!e || e.type !== 'capture') throw new Error('no capture');
      return e;
    };

    it('stolen is empty for a capture of empty ground', () => {
      const w = soloWorld();
      expect(captureOf(closeLoop(w)).stolen).toEqual([]);
    });

    it('stolen lists the share of the arena taken from each rival', () => {
      const w = soloWorld();
      // Bot 1's land straddles the loop's far corner; its head sits on the part that stays.
      const b = placeBot(w, v(11, 11), 0, v(9, 9), 3);
      const had = landArea(b.land);
      const ev = captureOf(closeLoop(w));
      expect(b.alive).toBe(true);
      const lost = ((had - landArea(b.land)) / (Math.PI * CONFIG.ARENA_R ** 2)) * 100;
      expect(lost).toBeGreaterThan(0);
      expect(ev.stolen).toHaveLength(1);
      expect(ev.stolen[0].playerId).toBe(1);
      expect(ev.stolen[0].pct).toBeCloseTo(lost, 9);
      expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    });

    it('a burning player that gets home emits escape after its capture', () => {
      const w = soloWorld();
      const h = w.players[0];
      const b = placeBot(w, v(-40, -30), 0);
      h.burn = { s0: 1, back: 1, front: 1, killerId: b.id, killerDeaths: b.deaths };
      const events = closeLoop(w);
      expect(h.alive).toBe(true);
      expect(h.burn).toBeNull();
      const iCap = events.findIndex((e) => e.type === 'capture');
      const iEsc = events.findIndex((e) => e.type === 'escape');
      expect(events[iEsc]).toEqual({ type: 'escape', playerId: 0 });
      expect(iEsc).toBeGreaterThan(iCap);
    });

    it('no escape event for a capture without a burn', () => {
      const w = soloWorld();
      expect(closeLoop(w).some((e) => e.type === 'escape')).toBe(false);
    });
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
    expect(w.events).toContainEqual({ type: 'death', playerId: 2, killerId: 0, cause: 'captured' });
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
    // The human burnt this trail, so it took the bot's land rather than leaving it to sink.
    expect(b.dyingLand).toBeNull();
    expect(b.land.length).toBe(0);
    expect(landContains(w.players[0].land, v(40, 40))).toBe(true);
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
    w.revivesLeft = 0; // revive used up: the death ends the game
    for (let i = 0; i < 60 && !w.over; i++) step(w, NO_INPUT);
    expect(h.alive).toBe(false);
    expect(w.over).toBe(true);
    expect(w.won).toBe(false);
    expect(w.events).toContainEqual({ type: 'death', playerId: 0, killerId: 1, cause: 'trail' });
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

describe('revive', () => {
  /** The human (at x = 10, heading north) has a trail along y = 0 that bot 1 is about to cross. */
  function trailTrap(w: World): Player {
    const h = w.players[0];
    h.pos = v(10, 0.2);
    h.prevPos = v(10, 0.1);
    h.heading = Math.PI / 2;
    h.targetHeading = Math.PI / 2;
    h.trail = [v(2.5, 0), v(10, 0)];
    return placeBot(w, v(6, 1), -Math.PI / 2);
  }

  /** Puts the world straight into the knocked-out state with `land` as the land at death. */
  function knockedOut(w: World, land: MultiPoly | null): void {
    const h = w.players[0];
    h.alive = false;
    h.trail = [];
    h.land = [];
    h.dyingLand = land;
    h.deathTime = w.time;
    w.awaitingRevive = true;
  }

  it('starts with one revive and nothing pending', () => {
    const w = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    expect(w.revivesLeft).toBe(1);
    expect(w.awaitingRevive).toBe(false);
    expect(w.downKillerId).toBeNull();
    expect(w.players[0].protectedUntil).toBe(0);
  });

  it("the human's first death emits down, not gameover, and freezes step", () => {
    const w = soloWorld();
    const b = trailTrap(w);
    for (let i = 0; i < 60 && !w.awaitingRevive; i++) step(w, NO_INPUT);
    const h = w.players[0];
    expect(w.awaitingRevive).toBe(true);
    expect(w.over).toBe(false);
    expect(h.alive).toBe(false);
    expect(w.events).toContainEqual({ type: 'down', playerId: 0, killerId: 1, cause: 'trail' });
    expect(w.events.some((e) => e.type === 'gameover' || e.type === 'death')).toBe(false);
    expect(w.downKillerId).toBe(1);
    expect(b.kills).toBe(1); // credited at the down moment
    const snap = JSON.stringify(w);
    for (let i = 0; i < 30; i++) step(w, NO_INPUT);
    expect(JSON.stringify(w)).toBe(snap); // step is a no-op while awaiting
  });

  it('a self-kill downs with a null killer and cause self', () => {
    const w = soloWorld();
    const h = w.players[0];
    for (let i = 0; i < 400 && h.alive; i++) {
      const t = w.time;
      const target = t < 1 ? 0 : t < 1.5 ? Math.PI / 2 : t < 2 ? Math.PI : -Math.PI / 2;
      step(w, steer(target));
    }
    expect(w.events).toContainEqual({ type: 'down', playerId: 0, killerId: null, cause: 'self' });
    expect(w.downKillerId).toBeNull();
  });

  it("selfCross 'pass' lets the human cross its own trail and live", () => {
    const w = soloWorld();
    w.selfCross = 'pass';
    const h = w.players[0];
    let downed = false;
    for (let i = 0; i < 400; i++) {
      const t = w.time;
      const target = t < 1 ? 0 : t < 1.5 ? Math.PI / 2 : t < 2 ? Math.PI : -Math.PI / 2;
      step(w, steer(target));
      if (w.events.some((e) => e.type === 'down' || e.type === 'death')) downed = true;
    }
    expect(downed).toBe(false);
    expect(h.alive).toBe(true);
  });

  it("selfCross defaults to 'die'", () => {
    expect(createWorld({ seed: 1, humanName: 'T', humanColor: 0 }).selfCross).toBe('die');
    expect(createWorld({ seed: 1, humanName: 'T', humanColor: 0, selfCross: 'pass' }).selfCross).toBe('pass');
  });

  it('reviveHuman restores the land at death and puts the head inside it', () => {
    const w = soloWorld();
    trailTrap(w);
    let areaAtDeath = 0;
    for (let i = 0; i < 60 && !w.awaitingRevive; i++) {
      areaAtDeath = landArea(w.players[0].land);
      step(w, NO_INPUT);
    }
    expect(w.awaitingRevive).toBe(true);
    reviveHuman(w);
    const h = w.players[0];
    expect(h.alive).toBe(true);
    expect(landArea(h.land)).toBeCloseTo(areaAtDeath, 6);
    expect(landContains(h.land, h.pos)).toBe(true);
    expect(h.prevPos).toEqual(h.pos);
    expect(h.trail).toEqual([]);
    expect(h.burn).toBeNull();
    expect(h.dyingLand).toBeNull();
    expect(w.revivesLeft).toBe(0);
    expect(w.awaitingRevive).toBe(false);
    expect(w.over).toBe(false);
    expect(h.protectedUntil).toBeCloseTo(w.time + 2, 9);
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('places the head on the land when the centroid is in a hole', () => {
    const w = soloWorld();
    // A ring of land: its centroid (the origin) lies in the hole.
    const ring: MultiPoly = [[circleRing(v(20, 0), 10, 48), circleRing(v(20, 0), 6, 48).reverse()]];
    knockedOut(w, ring);
    reviveHuman(w);
    const h = w.players[0];
    expect(landContains(h.land, h.pos)).toBe(true);
    expect(landArea(h.land)).toBeCloseTo(landArea(ring), 6);
  });

  it('spawns a fresh start circle when no land was left', () => {
    const w = soloWorld();
    knockedOut(w, null);
    reviveHuman(w);
    const h = w.players[0];
    expect(h.alive).toBe(true);
    expect(h.land.length).toBeGreaterThan(0);
    expect(landContains(h.land, h.pos)).toBe(true);
  });

  it('protection makes a trail hit on the human harmless for 2 s', () => {
    const w = soloWorld();
    knockedOut(w, disk(v(0, 0), 3));
    reviveHuman(w);
    const b = trailTrap(w);
    for (let i = 0; i < 90; i++) {
      step(w, NO_INPUT);
      expect(w.events.some((e) => e.type === 'down' || e.type === 'death' || e.type === 'gameover')).toBe(false);
    }
    expect(w.players[0].alive).toBe(true);
    expect(b.kills).toBe(0);
  });

  it('protection survives a head-on with a bigger rival', () => {
    const w = soloWorld();
    knockedOut(w, disk(v(0, 0), 3));
    reviveHuman(w);
    const h = w.players[0];
    h.heading = 0; h.targetHeading = 0;
    placeBot(w, v(h.pos.x + 0.6, h.pos.y), Math.PI, v(40, 40), 8);
    step(w, NO_INPUT);
    expect(h.alive).toBe(true);
  });

  /**
   * Bot 1 (land south of the origin) is one step from closing a loop that encloses
   * x in [-hw, hw], y up to `top`, around the revived human at the origin.
   */
  function captureAround(w: World, hw: number, top: number): Player {
    const b = placeBot(w, v(hw, -5.0), -Math.PI / 2, v(0, -12), 7.5);
    b.prevPos = v(hw, -4.9);
    b.trail = [v(-hw, -6), v(-hw, top), v(hw, top), v(hw, -4.9)];
    return b;
  }
  const revivedAtOrigin = (w: World): Player => {
    knockedOut(w, disk(v(0, 0), 3));
    reviveHuman(w);
    const h = w.players[0];
    h.pos = v(0, 0); h.prevPos = v(0, 0);
    h.heading = Math.PI / 2; h.targetHeading = Math.PI / 2;
    return h;
  };
  const captured = (w: World) => w.events.some((e) => e.type === 'capture' && e.playerId === 1);

  it('a capture covering a protected human head does not kill it', () => {
    const w = soloWorld();
    const h = revivedAtOrigin(w);
    captureAround(w, 1.5, 1.5);
    let cap = false;
    for (let i = 0; i < 30 && !cap; i++) { step(w, NO_INPUT); cap = captured(w); }
    expect(cap).toBe(true);
    expect(h.alive).toBe(true);
    expect(h.land.length).toBeGreaterThan(0); // keeps a side piece
    expect(w.events.some((e) => e.type === 'down' || e.type === 'death')).toBe(false);
  });

  it('a protected human whose land is all taken dies once protection ends', () => {
    const w = soloWorld();
    const h = revivedAtOrigin(w);
    const b = captureAround(w, 4, 4);
    let cap = false;
    for (let i = 0; i < 30 && !cap; i++) { step(w, NO_INPUT); cap = captured(w); }
    expect(cap).toBe(true);
    expect(h.land).toEqual([]);
    let death = null;
    for (let i = 0; i < 200 && !death; i++) {
      expect(h.alive).toBe(true);
      step(w, NO_INPUT);
      death = w.events.find((e) => e.type === 'death') ?? null;
      if (!death) expect(w.time).toBeLessThan(h.protectedUntil);
    }
    expect(death).toEqual({ type: 'death', playerId: 0, killerId: 1, cause: 'captured' });
    expect(h.alive).toBe(false);
    expect(w.time).toBeGreaterThanOrEqual(h.protectedUntil);
    expect(w.time - CONFIG.DT).toBeLessThan(h.protectedUntil); // the first tick after protection
    expect(b.kills).toBe(1);
    expect(w.over).toBe(true);
  });

  it('the second death ends the game', () => {
    const w = soloWorld();
    knockedOut(w, disk(v(0, 0), 3));
    reviveHuman(w);
    while (w.time < w.players[0].protectedUntil + 0.05) step(w, NO_INPUT);
    trailTrap(w);
    for (let i = 0; i < 60 && !w.over; i++) step(w, NO_INPUT);
    expect(w.over).toBe(true);
    expect(w.awaitingRevive).toBe(false);
    expect(w.events).toContainEqual({ type: 'death', playerId: 0, killerId: 1, cause: 'trail' });
    expect(w.events).toContainEqual({ type: 'gameover' });
  });

  it('declineRevive ends the game with gameover', () => {
    const w = soloWorld();
    const b = trailTrap(w);
    for (let i = 0; i < 60 && !w.awaitingRevive; i++) step(w, NO_INPUT);
    const land = w.players[0].dyingLand;
    declineRevive(w);
    expect(w.over).toBe(true);
    expect(w.awaitingRevive).toBe(false);
    expect(w.events).toContainEqual({ type: 'gameover' });
    // the final death; the kill was already credited at the down
    expect(w.events).toContainEqual({ type: 'death', playerId: 0, killerId: 1, cause: 'trail' });
    expect(b.kills).toBe(1);
    // only now (not at the down) does the killer take the human's land
    const absorb = w.events.find((e) => e.type === 'absorb');
    expect(absorb).toMatchObject({ playerId: 1, victimId: 0, region: land });
    expect(w.players[0].dyingLand).toBeNull();
    expect(landArea(b.land)).toBeGreaterThan(landArea(land!));
  });

  it('a down keeps the land for the revive: the killer takes nothing yet', () => {
    const w = soloWorld();
    const b = trailTrap(w);
    const before = landArea(b.land);
    for (let i = 0; i < 60 && !w.awaitingRevive; i++) step(w, NO_INPUT);
    expect(w.players[0].dyingLand).not.toBeNull();
    expect(landArea(b.land)).toBeCloseTo(before);
    expect(w.events.some((e) => e.type === 'absorb')).toBe(false);
  });
});

describe('killer takes the land', () => {
  it('a bot killed by the human hands over its land as an absorb event', () => {
    const w = soloWorld();
    const b = placeBot(w, v(5, 6), Math.PI / 2);
    b.trail = [v(5, -5), v(5, 5)];
    const botLand = b.land;
    const before = pct(w, 0);
    let absorb: Extract<World['events'][number], { type: 'absorb' }> | undefined;
    for (let i = 0; i < 60 && b.alive; i++) {
      step(w, NO_INPUT);
      absorb ??= w.events.find((e) => e.type === 'absorb') as typeof absorb;
    }
    expect(absorb).toMatchObject({ playerId: 0, victimId: 1, region: botLand });
    expect(absorb!.gainedPct).toBeCloseTo((landArea(botLand) / (Math.PI * CONFIG.ARENA_R ** 2)) * 100, 3);
    expect(pct(w, 0)).toBeCloseTo(before + absorb!.gainedPct, 3);
    expect(landContains(w.players[0].land, v(40, 40))).toBe(true);
  });

  it('a self-kill leaves the land to sink (nobody takes it)', () => {
    const w = soloWorld();
    const b = placeBot(w, v(20, -20), Math.PI / 2);
    b.trail = [v(18, -18), v(22, -18), v(22, -22), v(20, -22), v(20, -21)];
    for (let i = 0; i < 60 && b.alive; i++) step(w, NO_INPUT);
    expect(b.alive).toBe(false);
    expect(b.dyingLand).not.toBeNull();
    expect(landContains(w.players[0].land, v(40, 40))).toBe(false);
  });
});
