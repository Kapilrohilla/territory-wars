import { describe, it, expect } from 'vitest';
import { createLoop } from '../src/game/loop';

const DT = 1 / 60;

describe('createLoop', () => {
  it('fixed steps per second', () => {
    let steps = 0;
    const loop = createLoop(() => { steps++; }, () => {}, DT);
    let t = 1000;
    loop.tick(t); // first tick only records time
    for (let i = 0; i < 60; i++) { t += 1000 / 60; loop.tick(t); }
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(61);
  });

  it('accumulator clamps large frame gaps', () => {
    let steps = 0;
    const loop = createLoop(() => { steps++; }, () => {}, DT);
    loop.tick(0);
    loop.tick(5000);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(15);
  });

  it('alpha in [0,1)', () => {
    const alphas: number[] = [];
    const loop = createLoop(() => {}, (a) => { alphas.push(a); }, DT);
    let t = 0;
    loop.tick(t);
    const gaps = [7, 16.67, 3, 33.4, 10, 1, 250, 16, 5000, 8.3, 16.67, 16.67];
    for (const g of gaps) { t += g; loop.tick(t); }
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('first tick records time without stepping', () => {
    let steps = 0;
    const loop = createLoop(() => { steps++; }, () => {}, DT);
    loop.tick(123456);
    expect(steps).toBe(0);
  });
});
