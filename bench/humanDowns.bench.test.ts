// Run with `npm run bench` (or `npx vitest run bench/humanDowns.bench.test.ts --silent=false`).
// Not part of `npm test`: ~1–2 min. How dangerous each difficulty's bots are to a human: a
// scripted human makes triangle trips (legs 6–16 u) out of its land, is revived on every
// down, and its downs are counted by cause. Env: BENCH_SEEDS (default 12), BENCH_SEED0
// (first seed, default 1), BENCH_SECONDS
// (default 90), BENCH_DIFFS (default "normal,hard"), BENCH_HARD (JSON overrides for
// DIFFICULTY.hard, for tuning experiments).
import { it } from 'vitest';
import { createWorld, step, pct, reviveHuman } from '../src/sim/world';
import { createBrains, botInputs } from '../src/sim/bots';
import { DIFFICULTY, type Difficulty } from '../src/sim/config';
import { mulberry32 } from '../src/sim/rng';
import type { DeathCause, Input } from '../src/sim/types';
import type { Vec } from '../src/sim/geometry';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Array.from({ length: Number(env.BENCH_SEEDS ?? 12) }, (_, i) => i + Number(env.BENCH_SEED0 ?? 1));
const SECONDS = Number(env.BENCH_SECONDS ?? 90);
const DIFFS = (env.BENCH_DIFFS ?? 'normal,hard').split(',') as Difficulty[];
if (env.BENCH_HARD) Object.assign(DIFFICULTY.hard, JSON.parse(env.BENCH_HARD));

type Downs = Record<DeathCause, number>;
const noDowns = (): Downs => ({ headon: 0, trail: 0, self: 0, captured: 0 });

function run(difficulty: Difficulty, seed: number) {
  const w = createWorld({ seed, humanName: 'Tester', humanColor: 0, difficulty });
  const brains = createBrains(w);
  const rng = mulberry32(seed + 100);
  const hr = mulberry32(seed + 999);
  const downs = noDowns();
  let wps: Vec[] = [];
  let botLand = 0, humanLand = 0, samples = 0, kills = 0;
  const clampR = (v: Vec) => { const d = Math.hypot(v.x, v.y); return d > 80 ? { x: (v.x * 80) / d, y: (v.y * 80) / d } : v; };
  for (let i = 1; i <= 60 * SECONDS; i++) {
    const h = w.players[w.humanId];
    if (wps.length === 0 && h.trail.length === 0) {
      // Out a leg, turn 90°, a leg, then straight back to where it left from.
      const a = hr() * Math.PI * 2, L = 6 + hr() * 10, s = hr() < 0.5 ? 1 : -1;
      const p1 = clampR({ x: h.pos.x + Math.cos(a) * L, y: h.pos.y + Math.sin(a) * L });
      const p2 = clampR({ x: p1.x + Math.cos(a + (s * Math.PI) / 2) * L, y: p1.y + Math.sin(a + (s * Math.PI) / 2) * L });
      wps = [p1, p2, { ...h.pos }];
    }
    while (wps.length && Math.hypot(wps[0].x - h.pos.x, wps[0].y - h.pos.y) < 1) wps.shift();
    const inputs = new Map<number, Input>(botInputs(w, brains, rng));
    const t = wps[0];
    inputs.set(w.humanId, { targetHeading: t ? Math.atan2(t.y - h.pos.y, t.x - h.pos.x) : null });
    step(w, inputs);
    for (const e of w.events) {
      if (e.type === 'down' && e.playerId === w.humanId) downs[e.cause]++;
      if (e.type === 'death' && e.killerId === w.humanId && e.playerId !== w.humanId) kills++;
    }
    if (w.awaitingRevive) { w.revivesLeft = 99; reviveHuman(w); wps = []; }
    if (i % 60 === 0) {
      let s = 0, n = 0;
      for (const p of w.players) if (!p.isHuman && p.alive) { s += pct(w, p.id); n++; }
      botLand += n > 0 ? s / n : 0;
      humanLand += pct(w, w.humanId);
      samples++;
    }
  }
  return { downs, botLand: botLand / samples, humanLand: humanLand / samples, kills };
}

it('human downs by cause, per difficulty', () => {
  for (const d of DIFFS) {
    const tot = noDowns();
    let botLand = 0, humanLand = 0, kills = 0;
    for (const seed of SEEDS) {
      const r = run(d, seed);
      for (const k of Object.keys(tot) as DeathCause[]) tot[k] += r.downs[k];
      botLand += r.botLand; humanLand += r.humanLand; kills += r.kills;
    }
    const total = Object.values(tot).reduce((a, b) => a + b, 0);
    console.log(`${d.padEnd(6)} downs ${total} (head-on ${tot.headon}, cut/burn ${tot.trail}, self ${tot.self}, captured ${tot.captured})`
      + `  bot land ${(botLand / SEEDS.length).toFixed(3)}%  human land ${(humanLand / SEEDS.length).toFixed(3)}%`
      + `  bots killed by the human ${kills}  [${SEEDS.length} seeds × ${SECONDS} s]`);
  }
}, 1_800_000);
