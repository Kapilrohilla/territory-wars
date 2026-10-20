import { describe, it, expect, vi } from 'vitest';
import { centroid, createEffects, formatGain, sparkVelocities } from '../src/game/effects';
import { createWorld } from '../src/sim/world';
import { circleRing, type MultiPoly } from '../src/sim/geometry';
import { CONFIG } from '../src/sim/config';

const square = (x: number, y: number, s: number): MultiPoly => [[[
  { x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s },
]]];

describe('formatGain', () => {
  it('is "+x.x%" with one decimal', () => {
    expect(formatGain(1.234)).toBe('+1.2%');
    expect(formatGain(0.05)).toBe('+0.1%');
    expect(formatGain(12)).toBe('+12.0%');
  });
});

describe('centroid', () => {
  it('finds the centre of a square and a circle', () => {
    const c = centroid(square(2, 4, 2));
    expect(c.x).toBeCloseTo(3);
    expect(c.y).toBeCloseTo(5);
    const d = centroid([[circleRing({ x: -5, y: 7 }, 3, 24)]]);
    expect(d.x).toBeCloseTo(-5);
    expect(d.y).toBeCloseTo(7);
  });
  it('is area-weighted across pieces', () => {
    const c = centroid([...square(0, 0, 2), ...square(10, 0, 1)]);
    expect(c.x).toBeLessThan(5);
  });
});

describe('createEffects', () => {
  it('human capture nudges, masks the region, then expires', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    const cam = { nudge: vi.fn() };
    const region = square(0, 0, 2);
    fx.onEvents([{ type: 'capture', playerId: world.humanId, gainedPct: 1.5, region }], world, cam);
    expect(cam.nudge).toHaveBeenCalledWith(0.3);
    expect(fx.landMask(world.humanId)).toEqual([region]);
    expect(fx.busy()).toBe(true);
    fx.update(0.25); // capture fade (200 ms) done, text (900 ms) still up
    expect(fx.landMask(world.humanId)).toBeUndefined();
    expect(fx.busy()).toBe(true);
    fx.update(0.7);
    expect(fx.busy()).toBe(false);
  });

  it('bot capture animates the region without nudging', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    const cam = { nudge: vi.fn() };
    fx.onEvents([{ type: 'capture', playerId: 1, gainedPct: 2, region: square(0, 0, 1) }], world, cam);
    expect(cam.nudge).not.toHaveBeenCalled();
    expect(fx.landMask(1)).toHaveLength(1);
  });

  it('death snapshots the dying land and shrinks it over DEATH_SHRINK_S', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const p = world.players[2];
    p.dyingLand = square(0, 0, 3);
    p.land = [];
    const fx = createEffects();
    fx.onEvents([{ type: 'death', playerId: 2, killerId: null, cause: 'self' }], world, { nudge: () => {} });
    expect(fx.busy()).toBe(true);
    p.dyingLand = null; // sim clearing it must not affect the effect
    fx.update(CONFIG.DEATH_SHRINK_S - 0.05);
    expect(fx.busy()).toBe(true);
    fx.update(0.1);
    expect(fx.busy()).toBe(false);
  });

  it('a down (revivable) does not start the death shrink', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const p = world.players[0];
    p.dyingLand = square(0, 0, 3);
    p.land = [];
    const fx = createEffects();
    fx.onEvents([{ type: 'down', playerId: 0, killerId: 1, cause: 'trail' }], world, { nudge: () => {} });
    expect(fx.busy()).toBe(false);
  });
});

describe('cut sparks', () => {
  const burning = (world: ReturnType<typeof createWorld>, victim = 1) => {
    const v = world.players[victim];
    v.trail = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
    v.pos = { x: 4, y: 2 };
    v.burn = { s0: 2, back: 2, front: 2, killerId: world.humanId, killerDeaths: 0 };
    return v;
  };

  it('a burn the human starts sparks once, keeps busy() while the burst plays, then settles', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    fx.observe(world);
    expect(fx.busy()).toBe(false);
    burning(world);
    fx.observe(world);
    expect(fx.busy()).toBe(true);
    fx.update(1);
    expect(fx.busy()).toBe(false);
    fx.observe(world); // same burn: no second burst
    expect(fx.busy()).toBe(false);
  });

  it('the cut event sparks, and observe() does not repeat it', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    burning(world);
    const cut = { type: 'cut', hitterId: world.humanId, victimId: 1 } as unknown as Parameters<typeof fx.onEvents>[0][number];
    fx.onEvents([cut], world, { nudge: vi.fn() });
    expect(fx.busy()).toBe(true);
    fx.update(1);
    fx.observe(world);
    expect(fx.busy()).toBe(false);
  });

  it('a bot burning another bot does not spark', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    burning(world).burn!.killerId = 2;
    fx.observe(world);
    expect(fx.busy()).toBe(false);
  });
});

describe('sparkVelocities', () => {
  it('spreads n sparks around the circle within the speed range', () => {
    const out = Array.from({ length: 8 }, () => ({ vx: 0, vy: 0 }));
    sparkVelocities(8, 10, () => 0.5, out);
    for (const v of out) {
      const sp = Math.hypot(v.vx, v.vy);
      expect(sp).toBeGreaterThanOrEqual(5.5 - 1e-9);
      expect(sp).toBeLessThanOrEqual(10 + 1e-9);
    }
    const sx = out.reduce((a, v) => a + v.vx, 0), sy = out.reduce((a, v) => a + v.vy, 0);
    expect(Math.hypot(sx, sy)).toBeLessThan(1e-6); // evenly spread: no net push
  });
});
