// Bots-only difficulty check (Task 8): 3 seeds × 60 s per difficulty, the human parked at
// home. Hard bots (smarter, same speed and rules) must hold more land on average than Normal
// bots, with no more self-deaths. Prints the numbers (`npx vitest run tests/difficulty.test.ts
// --silent=false`).
import { it, expect } from 'vitest';
import { createWorld, step, pct } from '../src/sim/world';
import { createBrains, botInputs } from '../src/sim/bots';
import { mulberry32 } from '../src/sim/rng';
import type { Difficulty } from '../src/sim/config';
import type { Input } from '../src/sim/types';

const SEEDS = [1, 2, 3];
const SECONDS = 60;

/** Mean (over 1 s samples) of the average land % of the alive bots, plus self-death count. */
function run(difficulty: Difficulty, seed: number): { land: number; self: number; deaths: number } {
  const w = createWorld({ seed, humanName: 'Tester', humanColor: 0, difficulty });
  const brains = createBrains(w);
  const rng = mulberry32(seed + 100);
  const home = { ...w.players[w.humanId].pos };
  // The parked human can't be knocked out (that would freeze the world behind the revive
  // offer); bots can still take its land.
  w.players[w.humanId].protectedUntil = Infinity;
  let landSum = 0, samples = 0, self = 0, deaths = 0;
  for (let i = 1; i <= 60 * SECONDS; i++) {
    const inputs = new Map<number, Input>(botInputs(w, brains, rng));
    inputs.set(w.humanId, { targetHeading: null });
    const h = w.players[w.humanId];
    h.pos = { ...home }; h.prevPos = { ...home }; h.trail = [];
    step(w, inputs);
    for (const e of w.events) {
      if (e.type !== 'death' || e.playerId === w.humanId) continue;
      deaths++;
      if (e.cause === 'self') self++;
    }
    if (i % 60 === 0) {
      let s = 0, n = 0;
      for (const p of w.players) if (!p.isHuman && p.alive) { s += pct(w, p.id); n++; }
      landSum += n > 0 ? s / n : 0;
      samples++;
    }
    if (w.over || w.awaitingRevive) throw new Error('the parked human went down');
  }
  return { land: landSum / samples, self, deaths };
}

it('difficulty check: hard bots hold more land than normal, with no more self-deaths', () => {
  const res: Record<string, { land: number; self: number }> = {};
  for (const d of ['normal', 'hard'] as const) {
    let land = 0, self = 0, deaths = 0;
    const per: string[] = [];
    for (const seed of SEEDS) {
      const r = run(d, seed);
      land += r.land; self += r.self; deaths += r.deaths;
      per.push(`s${seed}: ${r.land.toFixed(2)}% self ${r.self} deaths ${r.deaths}`);
    }
    res[d] = { land: land / SEEDS.length, self };
    console.log(`${d.padEnd(6)} avg bot land ${(land / SEEDS.length).toFixed(3)}%  self-deaths ${self}  all deaths ${deaths}  [${per.join('; ')}]`);
  }
  expect(res.hard.land).toBeGreaterThan(res.normal.land);
  expect(res.hard.self).toBeLessThanOrEqual(res.normal.self);
}, 60_000);
