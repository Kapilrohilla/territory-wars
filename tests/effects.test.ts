import { describe, it, expect, vi } from 'vitest';
import {
  SPAWN_HEIGHT, SPAWN_S, centroid, chunkAlpha, createEffects, formatGain, killText, spawnPose, sparkVelocities,
} from '../src/game/effects';
import { createWorld } from '../src/sim/world';
import { circleRing, type MultiPoly } from '../src/sim/geometry';
import { playerShade } from '../src/game/palette';

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
    fx.onEvents([{ type: 'capture', playerId: world.humanId, gainedPct: 1.5, region, stolen: [] }], world, cam);
    expect(cam.nudge).toHaveBeenCalledWith(0.3);
    expect(fx.landMask(world.humanId)).toEqual([region]);
    expect(fx.busy()).toBe(true);
    fx.update(0.55); // capture rise (500 ms) done, text (1.2 s) still up
    expect(fx.landMask(world.humanId)).toBeUndefined();
    expect(fx.busy()).toBe(true);
    fx.update(0.7);
    expect(fx.busy()).toBe(false);
  });

  it('bot capture animates the region without nudging', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    const cam = { nudge: vi.fn() };
    fx.onEvents([{ type: 'capture', playerId: 1, gainedPct: 2, region: square(0, 0, 1), stolen: [] }], world, cam);
    expect(cam.nudge).not.toHaveBeenCalled();
    expect(fx.landMask(1)).toHaveLength(1);
  });

  it('death snapshots the dying land and sinks it, with a burst of chunks', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const p = world.players[2];
    p.dyingLand = square(0, 0, 3);
    p.land = [];
    const fx = createEffects();
    fx.onEvents([{ type: 'death', playerId: 2, killerId: null, cause: 'self' }], world, { nudge: () => {} });
    expect(fx.busy()).toBe(true);
    p.dyingLand = null; // sim clearing it must not affect the effect
    fx.update(0.3);
    expect(fx.busy()).toBe(true);
    fx.update(1); // sink (0.35 s) and chunks (≤ 0.8 s) done
    expect(fx.busy()).toBe(false);
  });

  it('a down (revivable) bursts but does not sink the land; the final death does not burst again', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const p = world.players[0];
    p.dyingLand = square(0, 0, 3);
    p.land = [];
    p.deaths = 1;
    const fx = createEffects();
    fx.onEvents([{ type: 'down', playerId: 0, killerId: 1, cause: 'trail' }], world, { nudge: () => {} });
    expect(fx.busy()).toBe(true); // chunks only
    fx.update(1);
    expect(fx.busy()).toBe(false);
    fx.onEvents([{ type: 'death', playerId: 0, killerId: 1, cause: 'trail' }], world, { nudge: () => {} });
    fx.update(0.4); // sink done; a second burst would still be flying
    expect(fx.busy()).toBe(false);
  });

  it('taken land flips into the killer\'s land (masked, then settles) instead of sinking', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    const region = square(10, 10, 3);
    fx.onEvents([
      { type: 'death', playerId: 2, killerId: world.humanId, cause: 'trail' },
      { type: 'absorb', playerId: world.humanId, victimId: 2, gainedPct: 0.03, region },
    ], world, { nudge: vi.fn() });
    expect(fx.landMask(world.humanId)).toEqual([region]);
    fx.update(1.3);
    expect(fx.landMask(world.humanId)).toBeUndefined();
    expect(fx.busy()).toBe(false);
  });

  it('a kill by the human pops an escalating callout and a stronger nudge', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    const cam = { nudge: vi.fn() };
    world.players[world.humanId].kills = 2;
    fx.onEvents([{ type: 'death', playerId: 3, killerId: world.humanId, cause: 'trail' }], world, cam);
    expect(cam.nudge).toHaveBeenCalledWith(0.55);
    const bot = vi.fn();
    fx.onEvents([{ type: 'death', playerId: 4, killerId: 5, cause: 'trail' }], world, { nudge: bot });
    expect(bot).not.toHaveBeenCalled();
  });
});

describe('spawn pops', () => {
  it('every head drops in on its first life, then settles', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    fx.observe(world);
    expect(fx.headPose(world.humanId)?.lift).toBeCloseTo(SPAWN_HEIGHT);
    expect(fx.landMask(world.humanId)).toEqual([world.players[world.humanId].land]); // start land rises
    fx.update(SPAWN_S + 0.01);
    expect(fx.headPose(world.humanId)).toBeNull();
    fx.observe(world); // same life: no second pop
    expect(fx.headPose(world.humanId)).toBeNull();
  });

  it('a new life (respawn or revive) pops again', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    fx.observe(world);
    fx.update(1);
    world.players[2].deaths++;
    fx.observe(world);
    expect(fx.headPose(2)).not.toBeNull();
    expect(fx.headPose(3)).toBeNull();
  });
});

describe('spawnPose', () => {
  it('falls from SPAWN_HEIGHT, squashes wide, stretches tall, then settles', () => {
    expect(spawnPose(0)!.lift).toBeCloseTo(SPAWN_HEIGHT);
    expect(spawnPose(0.249)!.lift).toBeLessThan(0.05);
    const squash = spawnPose(0.35)!;
    expect(squash.lift).toBe(0);
    expect(squash.sx).toBeGreaterThan(1);
    expect(squash.sy).toBeLessThan(1);
    const stretch = spawnPose(0.45)!;
    expect(stretch.sx).toBeLessThan(1);
    expect(stretch.sy).toBeGreaterThan(1);
    const end = spawnPose(SPAWN_S - 1e-6)!;
    expect(end.sx).toBeCloseTo(1, 3);
    expect(end.sy).toBeCloseTo(1, 3);
    expect(spawnPose(SPAWN_S)).toBeNull();
  });
});

describe('killText', () => {
  it('escalates with the kill count', () => {
    expect(killText(1)).toBe('Takedown!');
    expect(killText(2)).toBe('Double takedown!');
    expect(killText(3)).toBe('Triple takedown!');
    expect(killText(5)).toBe('Unstoppable ×5!');
  });
});

describe('chunkAlpha / playerShade', () => {
  it('chunks fade from full to half at mid-life to gone', () => {
    expect(chunkAlpha(0)).toBe(1);
    expect(chunkAlpha(0.5)).toBeCloseTo(0.5);
    expect(chunkAlpha(1)).toBe(0);
  });
  it('shade runs from the lip (0) to the base (1) colour', () => {
    expect(playerShade(0, 0)).toBe('hsl(355, 45.0%, 54.0%)');
    expect(playerShade(0, 1)).toBe('hsl(355, 78.0%, 70.0%)');
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
    fx.update(1); // let the spawn pops settle
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
    fx.observe(world);
    fx.update(1); // let the spawn pops settle
    burning(world);
    const cut = { type: 'cut', hitterId: world.humanId, victimId: 1 } as const;
    fx.onEvents([cut], world, { nudge: vi.fn() });
    expect(fx.busy()).toBe(true);
    fx.update(1);
    fx.observe(world);
    expect(fx.busy()).toBe(false);
  });

  it('a bot burning another bot does not spark', () => {
    const world = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const fx = createEffects();
    fx.observe(world);
    fx.update(1); // let the spawn pops settle
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
