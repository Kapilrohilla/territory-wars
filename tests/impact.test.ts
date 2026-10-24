import { describe, expect, it } from 'vitest';
import {
  createHitStop, downTimeScale, DOWN_SLOW_SCALE, HITSTOP_MS, HITSTOP_SCALE, IMPACT_KEY, impactEnabled,
} from '../src/game/impact';
import { createCamera, punchEnvelope, PUNCH_MS } from '../src/game/camera';
import { createLoop } from '../src/game/loop';

describe('createHitStop', () => {
  it('blocks steps for HITSTOP_MS after a trigger, then allows them again', () => {
    expect(HITSTOP_MS).toBe(70);
    const hs = createHitStop();
    expect(hs.shouldStep(1000)).toBe(true);
    hs.trigger(1000);
    expect(hs.shouldStep(1000)).toBe(false);
    expect(hs.shouldStep(1069.9)).toBe(false);
    expect(hs.shouldStep(1070)).toBe(true);
    expect(hs.shouldStep(5000)).toBe(true);
  });

  it('an overlapping trigger extends the freeze from its own time', () => {
    const hs = createHitStop();
    hs.trigger(1000);
    hs.trigger(1050);
    expect(hs.shouldStep(1070)).toBe(false);
    expect(hs.shouldStep(1119)).toBe(false);
    expect(hs.shouldStep(1120)).toBe(true);
  });

  it('an earlier-stamped trigger never shortens a running freeze', () => {
    const hs = createHitStop();
    hs.trigger(1050);
    hs.trigger(1000);
    expect(hs.shouldStep(1100)).toBe(false);
    expect(hs.shouldStep(1120)).toBe(true);
  });

  it('clear() ends a freeze at once', () => {
    const hs = createHitStop();
    hs.trigger(0);
    hs.clear();
    expect(hs.shouldStep(1)).toBe(true);
  });
});

describe('impactEnabled', () => {
  it('is on by default and when storage is missing', () => {
    expect(IMPACT_KEY).toBe('territory-wars.impact');
    expect(impactEnabled({ getItem: () => null })).toBe(true);
    expect(impactEnabled({ getItem: () => '1' })).toBe(true);
  });

  it("is off only for '0'", () => {
    expect(impactEnabled({ getItem: (k) => (k === IMPACT_KEY ? '0' : null) })).toBe(false);
  });

  it('stays on when storage access throws', () => {
    expect(impactEnabled({ getItem: () => { throw new Error('SecurityError'); } })).toBe(true);
  });
});

describe('downTimeScale', () => {
  it('eases from full speed to 35% and stays there until the revive offer', () => {
    expect(DOWN_SLOW_SCALE).toBe(0.35);
    expect(downTimeScale(0)).toBeCloseTo(1, 9);
    let prev = 1;
    for (let t = 0; t <= 599; t += 10) {
      const s = downTimeScale(t);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(s).toBeGreaterThanOrEqual(DOWN_SLOW_SCALE - 1e-12);
      prev = s;
    }
    expect(downTimeScale(300)).toBeCloseTo(DOWN_SLOW_SCALE, 9);
    expect(downTimeScale(599)).toBeCloseTo(DOWN_SLOW_SCALE, 9);
  });

  it('is full speed again once the offer is up (and with no down)', () => {
    expect(downTimeScale(600)).toBe(1);
    expect(downTimeScale(10_000)).toBe(1);
    expect(downTimeScale(null)).toBe(1);
  });

  it('effects run at 25% during a hit-stop', () => {
    expect(HITSTOP_SCALE).toBe(0.25);
  });
});

describe('camera punch', () => {
  it('the envelope starts full, springs back and is spent after PUNCH_MS', () => {
    expect(PUNCH_MS).toBe(250);
    expect(punchEnvelope(0)).toBe(1);
    expect(punchEnvelope(1)).toBe(0);
    expect(punchEnvelope(2)).toBe(0);
    expect(punchEnvelope(-1)).toBe(0);
    for (let u = 0; u <= 1; u += 0.05) expect(Math.abs(punchEnvelope(u))).toBeLessThanOrEqual(1);
    expect(punchEnvelope(0.5)).toBeLessThan(punchEnvelope(0.1));
  });

  it('punch(0.12) zooms in 12% and settles back to the base zoom within 250 ms', () => {
    const cam = createCamera();
    cam.update({ x: 0, y: 0 }, 0, 0);
    const base = cam.halfHeight;
    cam.punch(0.12);
    cam.update({ x: 0, y: 0 }, 0, 0);
    expect(cam.halfHeight).toBeCloseTo(base * 0.88, 6);
    for (let i = 0; i < 16; i++) cam.update({ x: 0, y: 0 }, 0, 1 / 60);
    expect(cam.halfHeight).toBeCloseTo(base, 6);
  });
});

describe('createLoop canStep', () => {
  const DT = 1 / 60;

  it('steps nothing while frozen and never catches up the frozen time', () => {
    let steps = 0;
    let frozen = false;
    const alphas: number[] = [];
    const loop = createLoop(() => { steps++; }, (a) => alphas.push(a), DT, () => !frozen);
    let t = 0;
    loop.tick(t);
    for (let i = 0; i < 30; i++) { t += 1000 / 60; loop.tick(t); }
    const before = steps;
    frozen = true;
    for (let i = 0; i < 12; i++) { t += 1000 / 60; loop.tick(t); }
    expect(steps).toBe(before);
    frozen = false;
    t += 1000 / 60;
    loop.tick(t);
    expect(steps - before).toBeLessThanOrEqual(1);
    for (const a of alphas) { expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThan(1); }
  });

  it('a freeze that starts mid-frame stops the remaining catch-up steps', () => {
    let steps = 0;
    let frozen = false;
    const loop = createLoop(() => { steps++; if (steps === 2) frozen = true; }, () => {}, DT, () => !frozen);
    loop.tick(0);
    loop.tick(100); // ~6 steps due
    expect(steps).toBe(2);
    frozen = false;
    loop.tick(100 + 1000 / 60);
    expect(steps).toBeLessThanOrEqual(4);
  });
});
