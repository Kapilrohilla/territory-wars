import { describe, it, expect } from 'vitest';
import { finalSharePct } from '../src/game/session';
import { createWorld, pct } from '../src/sim/world';
import { circleRing } from '../src/sim/geometry';
import { landArea } from '../src/sim/territory';
import { CONFIG } from '../src/sim/config';

const share = (area: number) => (area / (Math.PI * CONFIG.ARENA_R ** 2)) * 100;

describe('finalSharePct', () => {
  it('is the live land while the human is alive', () => {
    const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 0 });
    expect(finalSharePct(w, 42)).toBeCloseTo(pct(w, w.humanId), 6);
  });

  it('is the dying land once the human is dead and the land is still sinking', () => {
    const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 0 });
    const h = w.players[w.humanId];
    const land = [[circleRing({ x: 0, y: 0 }, 10, 32)]];
    h.alive = false;
    h.dyingLand = land;
    expect(finalSharePct(w, 0)).toBeCloseTo(share(landArea(land)), 6);
  });

  it('falls back to the last living share when a killer absorbed the land', () => {
    const w = createWorld({ seed: 1, humanName: 'Tester', humanColor: 0 });
    const h = w.players[w.humanId];
    h.alive = false;
    h.dyingLand = null; // absorbLand hands it to the killer
    expect(finalSharePct(w, 4.99)).toBe(4.99);
  });
});
