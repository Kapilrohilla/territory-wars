import { describe, it, expect } from 'vitest';
import { createWorld, step, pct } from '../src/sim/world';
import { createBrains, botInputs } from '../src/sim/bots';
import { mulberry32 } from '../src/sim/rng';
import { angleDiff, circleRing, type MultiPoly, type Vec } from '../src/sim/geometry';
import type { Input, World } from '../src/sim/types';
import { landContains } from '../src/sim/territory';

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

  describe('ignores a human it cannot hurt', () => {
    const huntState = (prep: (w: World) => void) => {
      const w = setup(1, true);
      const b = w.players[1];
      b.pos = v(-30, 0); b.prevPos = v(-30, 0); b.heading = 0; b.targetHeading = 0;
      b.land = disk(v(-30, 0), 3);
      const h = w.players[0];
      h.pos = v(-24, 6); h.prevPos = v(-24, 6);
      h.land = disk(v(-24, 12), 3);
      h.trail = [];
      for (let y = -6; y <= 6; y += 0.25) h.trail.push(v(-24, y));
      prep(w);
      const brains = createBrains(w);
      botInputs(w, brains, mulberry32(3));
      return brains.get(1)!.state;
    };
    it('does not hunt a burning human trail', () => {
      expect(huntState(() => {})).toBe('hunt');
      expect(huntState((w) => { w.players[0].burn = { s0: 1, back: 0.5, front: 1.5, killerId: 2, killerDeaths: 0 }; }))
        .not.toBe('hunt');
    });
    it('does not hunt a protected human', () => {
      expect(huntState((w) => { w.players[0].protectedUntil = w.time + 1; })).not.toBe('hunt');
      expect(huntState((w) => { w.time = 5; w.players[0].protectedUntil = 4; })).toBe('hunt');
    });
  });

  it('hunt range scales with difficulty', () => {
    const run = (difficulty: 'easy' | 'normal' | 'hard', trailX: number, homeY = 12) => {
      const w = setup(1, true);
      w.difficulty = difficulty;
      const b = w.players[1];
      b.pos = v(-30, 0); b.prevPos = v(-30, 0); b.heading = 0; b.targetHeading = 0;
      b.land = disk(v(-30, 0), 3);
      const h = w.players[0];
      h.pos = v(trailX, 6); h.prevPos = v(trailX, 6);
      h.land = disk(v(trailX, homeY), 3);
      h.trail = [];
      for (let y = -6; y <= 6; y += 0.25) h.trail.push(v(trailX, y));
      const brains = createBrains(w);
      botInputs(w, brains, mulberry32(3));
      return brains.get(1)!.state;
    };
    // Hard hunts within huntRadius in any direction, but only a trail it can reach before the
    // human gets home, so its human lives far from the trail here (3 u from home it wouldn't).
    expect(run('hard', -16, 60)).toBe('hunt'); // 14 u ahead
    expect(run('hard', -16)).not.toBe('hunt'); // human 3 u from home: unreachable
    expect(run('normal', -16)).not.toBe('hunt'); // normal reach 10 u
    expect(run('normal', -22)).toBe('hunt'); // 8 u ahead
    expect(run('easy', -22)).not.toBe('hunt'); // easy reach 5 u
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
    b.burn = { s0: 2, back: 1, front: 3, killerId: 0, killerDeaths: 0 };
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

describe('hard bots (Task 8)', () => {
  /** Only bots `ids` alive; each gets a small home disk under it. Human gets land at `humanHome`. */
  function arena(difficulty: 'normal' | 'hard', ids: number[], humanHome: Vec): World {
    const w = setup(1, false);
    w.difficulty = difficulty;
    for (const p of w.players) {
      if (p.isHuman || ids.includes(p.id)) continue;
      p.alive = false; p.land = []; p.trail = []; p.respawnAt = null;
    }
    const h = w.players[w.humanId];
    h.land = disk(humanHome, 3);
    h.trail = [];
    return w;
  }
  function placeBot(w: World, id: number, pos: Vec, heading: number, home?: Vec) {
    const b = w.players[id];
    b.pos = pos; b.prevPos = pos; b.heading = heading; b.targetHeading = heading;
    b.land = disk(home ?? pos, 3); b.trail = []; b.burn = null;
  }
  /** Human trail along the straight line a→b (head at b, heading a→b). */
  function humanTrail(w: World, a: Vec, b: Vec) {
    const h = w.players[w.humanId];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    h.trail = [];
    for (let s = 0; s < len; s += 0.25) h.trail.push(v(a.x + ((b.x - a.x) * s) / len, a.y + ((b.y - a.y) * s) / len));
    h.pos = b; h.prevPos = b;
    h.heading = Math.atan2(b.y - a.y, b.x - a.x); h.targetHeading = h.heading;
  }

  it('the new tuning is off for easy and normal, on for hard', async () => {
    const { DIFFICULTY } = await import('../src/sim/config');
    for (const d of ['easy', 'normal'] as const) {
      const t = DIFFICULTY[d];
      expect([t.smartHunt, t.huntRadius, t.packSize, t.raidChance, t.safeReturn]).toEqual([false, 0, 0, 0, false]);
      expect(t.loopScale).toBe(1);
    }
    const h = DIFFICULTY.hard;
    expect([h.smartHunt, h.huntRadius, h.packSize, h.raidChance, h.safeReturn, h.loopScale])
      .toEqual([true, 25, 3, 0.25, true, 1.35]);
  });

  it('smartHunt: aims nearer the human head than the plain nearest point', () => {
    const heading = (d: 'normal' | 'hard') => {
      const w = arena(d, [1], v(-60, 40));
      placeBot(w, 1, v(0, -8), Math.PI / 2, v(0, -14));
      humanTrail(w, v(-20, 0), v(20, 0)); // head at (20, 0), moving +x
      const brains = createBrains(w);
      const inp = botInputs(w, brains, mulberry32(3));
      expect(brains.get(1)!.state).toBe('hunt');
      return inp.get(1)!.targetHeading!;
    };
    // Normal goes straight for the nearest point (0, 0): due north.
    expect(Math.abs(angleDiff(heading('normal'), Math.PI / 2))).toBeLessThan(0.05);
    // Hard aims towards the head end (x ≈ 20+): well east of north.
    const hard = heading('hard');
    expect(hard).toBeLessThan(Math.PI / 2 - 0.6);
    expect(hard).toBeGreaterThan(0);
  });

  it('wide awareness: notices a trail 20 u away at 120° off its heading (normal does not)', () => {
    const state = (d: 'normal' | 'hard') => {
      const w = arena(d, [1], v(60, 60));
      placeBot(w, 1, v(0, 0), 0);
      const c = v(20 * Math.cos((2 * Math.PI) / 3), 20 * Math.sin((2 * Math.PI) / 3));
      // A trail through c, perpendicular to the bot→c line, head at one end.
      const tx = -Math.sin((2 * Math.PI) / 3), ty = Math.cos((2 * Math.PI) / 3);
      humanTrail(w, v(c.x - tx * 6, c.y - ty * 6), v(c.x + tx * 6, c.y + ty * 6));
      const brains = createBrains(w);
      botInputs(w, brains, mulberry32(3));
      return brains.get(1)!.state;
    };
    expect(state('hard')).toBe('hunt');
    expect(state('normal')).not.toBe('hunt');
  });

  it('reachability: no hunt when the human is 1 u from home and the bot 15 u away', () => {
    const state = (humanHome: Vec) => {
      const w = arena('hard', [1], humanHome);
      placeBot(w, 1, v(0, 0), 0, v(-6, 0));
      humanTrail(w, v(15, -6), v(15, 6)); // head (15, 6)
      const brains = createBrains(w);
      botInputs(w, brains, mulberry32(3));
      return brains.get(1)!.state;
    };
    expect(state(v(15, 10))).not.toBe('hunt'); // land edge at y = 7: 1 u from the head
    expect(state(v(60, 60))).toBe('hunt'); // control: home far away
  });

  describe('pack hunting', () => {
    const ids = [1, 2, 3, 4, 5];
    function pack() {
      const w = arena('hard', ids, v(-70, -40));
      humanTrail(w, v(-20, 0), v(20, 0));
      // Five bots strung along the trail, 6..10 u away from it.
      placeBot(w, 1, v(-16, -6), Math.PI / 2, v(-16, -14));
      placeBot(w, 2, v(-8, 7), -Math.PI / 2, v(-8, 15));
      placeBot(w, 3, v(0, -8), Math.PI / 2, v(0, -16));
      placeBot(w, 4, v(8, 9), -Math.PI / 2, v(8, 17));
      placeBot(w, 5, v(16, -10), Math.PI / 2, v(16, -18));
      return w;
    }
    const hunting = (brains: Map<number, { state: string }>) => ids.filter((id) => brains.get(id)!.state === 'hunt');

    it('at most packSize (3) of 5 eligible bots hunt at once: the closest', () => {
      const w = pack();
      const brains = createBrains(w);
      const rng = mulberry32(3);
      botInputs(w, brains, rng);
      expect(hunting(brains)).toEqual([1, 2, 3]);
      for (let i = 0; i < 40; i++) {
        step(w, (() => { const m = new Map(botInputs(w, brains, rng)); m.set(w.humanId, { targetHeading: 0 }); return m; })());
        expect(hunting(brains).length).toBeLessThanOrEqual(3);
      }
    });

    it('commitment is re-evaluated every 0.5 s, not every tick', () => {
      const w = pack();
      const brains = createBrains(w);
      const rng = mulberry32(3);
      botInputs(w, brains, rng);
      expect(hunting(brains)).toEqual([1, 2, 3]);
      // Bot 5 jumps right next to the trail: closest now, but the pack holds until 0.5 s.
      placeBot(w, 5, v(16, -2), Math.PI / 2, v(16, -18));
      w.time += 0.3;
      botInputs(w, brains, rng);
      expect(hunting(brains)).not.toContain(5);
      w.time += 0.25;
      botInputs(w, brains, rng);
      expect(hunting(brains)).toContain(5);
      expect(hunting(brains).length).toBe(3);
    });

    it('pincer: committed bots aim at trail points ≥ 6 u of path length apart', () => {
      const w = pack();
      // All three committed bots sit at the same spot: only their slots tell them apart.
      for (const id of [1, 2, 3]) placeBot(w, id, v(0, -5 - id * 0.01), Math.PI / 2, v(0, -14 - id * 7));
      const brains = createBrains(w);
      const inp = botInputs(w, brains, mulberry32(3));
      expect(hunting(brains)).toEqual([1, 2, 3]);
      // Where each heading meets the trail line y = 0.
      const xs = [1, 2, 3].map((id) => {
        const p = w.players[id], a = inp.get(id)!.targetHeading!;
        return p.pos.x + (Math.cos(a) / Math.sin(a)) * (0 - p.pos.y);
      }).sort((a, b) => a - b);
      expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(6 - 0.3);
      expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(6 - 0.3);
    });
  });

  it('raid: a triggered raid plans waypoints through the human land', () => {
    const plan = (d: 'normal' | 'hard') => {
      const w = arena(d, [1], v(20, 0));
      placeBot(w, 1, v(0, 0), 0);
      const brains = createBrains(w);
      botInputs(w, brains, () => 0.1); // 0.1 < raidChance: the raid triggers
      return { w, wps: brains.get(1)!.waypoints };
    };
    const hard = plan('hard');
    const human = hard.w.players[hard.w.humanId];
    expect(hard.wps.some((q) => landContains(human.land, q))).toBe(true);
    const normal = plan('normal');
    expect(normal.wps.some((q) => landContains(human.land, q))).toBe(false);
  });

  it('safe return: an out bot heads home when the human head is near its trail', () => {
    const state = (d: 'normal' | 'hard', humanAt: Vec) => {
      const w = arena(d, [1], v(-60, 60));
      placeBot(w, 1, v(10, 12), Math.PI / 2, v(0, 0));
      const b = w.players[1];
      for (let y = 3; y < 12; y += 0.25) b.trail.push(v(10, y)); // 3 u off its land, now ~10 u out
      const h = w.players[w.humanId];
      h.pos = humanAt; h.prevPos = humanAt;
      const brains = createBrains(w);
      brains.get(1)!.state = 'out';
      brains.get(1)!.waypoints = [v(10, 30)];
      botInputs(w, brains, mulberry32(3));
      return brains.get(1)!.state;
    };
    expect(state('hard', v(14, 6))).toBe('return'); // 4 u from its trail, it is ~9 u from land
    expect(state('normal', v(14, 6))).toBe('out');
    expect(state('hard', v(40, 6))).toBe('out'); // far away: carry on
  });

  it('safe return also watches rival bot heads', () => {
    const w = arena('hard', [1, 2], v(-60, 60));
    placeBot(w, 1, v(10, 12), Math.PI / 2, v(0, 0));
    const b = w.players[1];
    for (let y = 3; y < 12; y += 0.25) b.trail.push(v(10, y));
    placeBot(w, 2, v(14, 6), Math.PI, v(30, 6));
    const h = w.players[w.humanId];
    h.pos = v(-60, 60); h.prevPos = v(-60, 60);
    const brains = createBrains(w);
    brains.get(1)!.state = 'out';
    brains.get(1)!.waypoints = [v(10, 30)];
    botInputs(w, brains, mulberry32(3));
    expect(brains.get(1)!.state).toBe('return');
  });

  it('bigger loops: hard waypoints may reach further than waypointMax', () => {
    let far = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = arena('hard', [1], v(-80, 0));
      placeBot(w, 1, v(30, 30), 0);
      const brains = createBrains(w);
      const rng = mulberry32(seed);
      botInputs(w, brains, rng);
      const wps = brains.get(1)!.waypoints;
      if (wps.length === 3) far = Math.max(far, Math.hypot(wps[1].x - wps[0].x, wps[1].y - wps[0].y));
    }
    expect(far).toBeGreaterThan(20); // hard waypointMax is 20; × 1.35 = 27
  });
});
