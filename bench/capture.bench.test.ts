// Run with `npm run bench`. Not part of `npm test` (timings are machine dependent).
import { it } from 'vitest';
import { captureLand } from '../src/sim/territory';
import type { MultiPoly, Vec } from '../src/sim/geometry';

const own: MultiPoly = [[[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]]];

/** 200-point wobbly loop leaving the square's east side at (10,2) and returning at (10,8). */
function wobblyTrail(n = 200): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const th = -Math.PI / 2 + Math.PI * f;
    const r = 3 + 12 * Math.sin(Math.PI * f) + 0.3 * Math.sin(f * 60);
    out.push({ x: 10 + r * Math.cos(th), y: 5 + r * Math.sin(th) });
  }
  return out;
}

it('captureLand, 200-point wobbly trail', () => {
  const trail = wobblyTrail();
  for (let i = 0; i < 50; i++) captureLand(own, trail); // warm up the JIT
  const times: number[] = [];
  for (let i = 0; i < 201; i++) {
    const t0 = performance.now();
    captureLand(own, trail);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`captureLand 200-pt wobbly trail: median ${times[100].toFixed(3)} ms, ` +
    `min ${times[0].toFixed(3)} ms, max ${times[200].toFixed(3)} ms (201 runs)`);
});
