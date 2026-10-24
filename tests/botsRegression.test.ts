import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createWorld, step } from '../src/sim/world';
import { createBrains, botInputs } from '../src/sim/bots';
import { mulberry32 } from '../src/sim/rng';
import type { Difficulty } from '../src/sim/config';
import type { Input } from '../src/sim/types';

/**
 * Easy and Normal bots must behave exactly as they did before the Hard-only bot work
 * (Task 8). These hashes were recorded at commit 0dc621d: a fixed-seed world, 30 s of
 * botInputs each tick, the human parked at home. If one fails, a change leaked into
 * Easy/Normal.
 */
function runHash(difficulty: Difficulty, seed: number, drive = false): string {
  const w = createWorld({ seed, humanName: 'Tester', humanColor: 0, difficulty });
  const brains = createBrains(w);
  const rng = mulberry32(seed + 1000);
  const home = { ...w.players[w.humanId].pos };
  for (let i = 0; i < 60 * 30; i++) {
    const inputs = new Map<number, Input>(botInputs(w, brains, rng));
    if (drive) {
      // Square-ish loops out of home and back: lays a live trail for the bots to hunt.
      inputs.set(w.humanId, { targetHeading: Math.floor(w.time / 1.2) * (Math.PI / 2) });
    } else {
      inputs.set(w.humanId, { targetHeading: null });
      const h = w.players[w.humanId];
      h.pos = { ...home }; h.prevPos = { ...home }; h.trail = [];
    }
    step(w, inputs);
    if (w.over) break;
  }
  if (!drive) expect(w.time).toBeGreaterThan(29.9); // the human survived: the whole 30 s ran
  return createHash('sha256').update(JSON.stringify(w)).digest('hex').slice(0, 16);
}

describe('bot regression (Easy/Normal unchanged)', () => {
  it('normal, seed 7, 30 s', () => {
    expect(runHash('normal', 7)).toBe('f32972bed9e78d5f');
  }, 30_000);
  it('normal, seed 9, 30 s, human driving loops', () => {
    expect(runHash('normal', 9, true)).toBe('51f910dbce3c00a0');
  }, 30_000);
  it('easy, seed 11, 30 s', () => {
    expect(runHash('easy', 11)).toBe('85af7c4c4df7b36a');
  }, 30_000);
});
