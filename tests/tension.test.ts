import { describe, it, expect } from 'vitest';
import { createDangerState, type DangerState } from '../src/game/danger';
import type { SoundName } from '../src/game/sound';
import { createWorld } from '../src/sim/world';
import { CAPTURE_AFTER_STEAL_S, ESCAPE_AFTER_CAPTURE_S } from '../src/game/sfxEvents';
import {
  createTension, TENSION_MIN, beatGain, beatInterval, burnVignetteAlpha, crackleInterval, createTensionClock, tickTension,
} from '../src/game/tension';

/** Runs the clock for `seconds` in frames of `dt`; counts heartbeats and crackles. */
function run(danger: number, burn: number | null, seconds: number, dt = 1 / 60) {
  const c = createTensionClock();
  let beats = 0, crackles = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    tickTension(c, danger, burn, dt);
    if (c.beat) beats++;
    if (c.crackle) crackles++;
  }
  return { beats, crackles };
}

describe('tension scheduling', () => {
  it('beats faster at higher danger', () => {
    const low = run(0.4, null, 10).beats;
    const high = run(0.95, null, 10).beats;
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThanOrEqual(Math.floor(10 / beatInterval(0.4)));
    expect(low).toBeLessThanOrEqual(Math.ceil(10 / beatInterval(0.4)) + 1);
  });

  it('is silent below 0.35 when not burning', () => {
    expect(TENSION_MIN).toBe(0.35);
    expect(run(0.34, null, 10)).toEqual({ beats: 0, crackles: 0 });
    expect(run(0, null, 10)).toEqual({ beats: 0, crackles: 0 });
  });

  it('beats and crackles while burning, even at low danger', () => {
    const r = run(0.1, 0.5, 5);
    expect(r.beats).toBeGreaterThan(0);
    expect(r.crackles).toBeGreaterThan(Math.floor(5 / crackleInterval(0.5)) - 2);
  });

  it('crackles faster as the burn closes in', () => {
    expect(run(0.5, 0.9, 5).crackles).toBeGreaterThan(run(0.5, 0.1, 5).crackles);
  });

  it('fires at most one beat per tick, even after a long frame', () => {
    const c = createTensionClock();
    tickTension(c, 1, 0.5, 5);
    expect(c.beat).toBe(true);
    expect(c.crackle).toBe(true);
    tickTension(c, 1, 0.5, 0.001);
    expect(c.beat).toBe(false);
  });

  it('does not re-trigger faster than the interval when danger flickers around the threshold', () => {
    const c = createTensionClock();
    let beats = 0;
    for (let i = 0; i < 30; i++) {
      tickTension(c, i % 2 ? 0.36 : 0.34, null, 1 / 60);
      if (c.beat) beats++;
    }
    expect(beats).toBe(1); // 0.5 s at an interval of ~0.77 s: just the first beat
  });

  it('uses the spec formulas', () => {
    expect(beatInterval(0)).toBeCloseTo(0.95);
    expect(beatInterval(1)).toBeCloseTo(0.45);
    expect(beatGain(0)).toBeCloseTo(0.02);
    expect(beatGain(1)).toBeCloseTo(0.08);
    expect(crackleInterval(0)).toBeCloseTo(0.22);
    expect(crackleInterval(1)).toBeCloseTo(0.1);
  });
});

describe('burnVignetteAlpha', () => {
  it('is 0.25 + 0.35·progress under reduced motion, steady over time', () => {
    expect(burnVignetteAlpha(0, 0, true)).toBeCloseTo(0.25);
    expect(burnVignetteAlpha(1, 0.37, true)).toBeCloseTo(0.6);
    expect(burnVignetteAlpha(0.5, 0.1, true)).toBe(burnVignetteAlpha(0.5, 0.33, true));
  });
  it('pulses at 2 Hz without exceeding the strength', () => {
    expect(burnVignetteAlpha(0.5, 0, false)).toBeCloseTo(burnVignetteAlpha(0.5, 0.5, false));
    let min = 1, max = 0;
    for (let t = 0; t < 0.5; t += 0.01) {
      const a = burnVignetteAlpha(0.5, t, false);
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
    expect(max).toBeLessThanOrEqual(0.25 + 0.35 * 0.5 + 1e-9);
    expect(max - min).toBeGreaterThan(0.05);
  });
});

describe('createTension', () => {
  const setup = () => {
    const w = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const played: SoundName[] = [];
    const t = createTension((n) => played.push(n));
    const d: DangerState = createDangerState(true);
    const h = w.players[w.humanId];
    const out = () => { h.trail = [{ x: 0, y: 0 }]; };
    const home = () => { h.trail = []; };
    return { w, played, t, d, out, home };
  };

  it('plays heartbeats while in danger and a relief chime on reaching home', () => {
    const { w, played, t, d, out, home } = setup();
    out();
    d.level = 0.8;
    for (let i = 0; i < 120; i++) t.update(w, 1 / 60, d);
    expect(played.filter((n) => n === 'heartbeat').length).toBeGreaterThanOrEqual(3);
    home();
    d.level = 0;
    played.length = 0;
    t.update(w, 1 / 60, d);
    expect(played).toEqual(['escape']);
    t.update(w, 1 / 60, d);
    expect(played).toEqual(['escape']); // once
  });

  it('skips the relief chime when the step already played escape', () => {
    const { w, played, t, d, out, home } = setup();
    out();
    d.level = 0.5;
    t.update(w, 1 / 60, d);
    home();
    d.level = 0;
    played.length = 0;
    t.heard('escape');
    t.update(w, 1 / 60, d);
    expect(played).toEqual([]);
  });

  it('delays the relief chime after a capture chord heard this step, like sfxEvents does', () => {
    const relief = (captureDelay: number | null) => {
      const w = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
      const played: { name: SoundName; delay?: number }[] = [];
      const t = createTension((name, o) => played.push({ name, delay: o?.delay }));
      const d: DangerState = createDangerState(true);
      const h = w.players[w.humanId];
      h.trail = [{ x: 0, y: 0 }];
      d.level = 0.5;
      t.update(w, 1 / 60, d);
      h.trail = [];
      d.level = 0;
      played.length = 0;
      if (captureDelay !== null) t.heard('capture', captureDelay);
      t.update(w, 1 / 60, d);
      expect(played.map((p) => p.name)).toEqual(['escape']);
      return played[0].delay ?? 0;
    };
    expect(relief(null)).toBe(0); // no capture: right away
    expect(relief(0)).toBeCloseTo(ESCAPE_AFTER_CAPTURE_S, 9);
    expect(relief(CAPTURE_AFTER_STEAL_S)).toBeCloseTo(CAPTURE_AFTER_STEAL_S + ESCAPE_AFTER_CAPTURE_S, 9);
  });

  it('is silent while awaiting revive, after the end and once disposed', () => {
    const { w, played, t, d, out } = setup();
    out();
    d.level = 1;
    d.burn = 0.5;
    w.awaitingRevive = true;
    for (let i = 0; i < 60; i++) t.update(w, 1 / 60, d);
    w.awaitingRevive = false;
    w.over = true;
    for (let i = 0; i < 60; i++) t.update(w, 1 / 60, d);
    w.over = false;
    t.dispose();
    for (let i = 0; i < 60; i++) t.update(w, 1 / 60, d);
    expect(played).toEqual([]);
  });

  it('hands the heartbeat its gain from beatGain (single source)', () => {
    const w = createWorld({ seed: 1, humanName: 'T', humanColor: 0 });
    const gains: (number | undefined)[] = [];
    const t = createTension((n, o) => { if (n === 'heartbeat') gains.push(o?.gain); });
    const d = createDangerState(true);
    w.players[w.humanId].trail = [{ x: 0, y: 0 }];
    d.level = 0.7;
    t.update(w, 1 / 60, d);
    expect(gains).toEqual([beatGain(0.7)]);
  });

  it('keeps the crackle but drops the heartbeat with danger warnings off', () => {
    const { w, played, t, d, out } = setup();
    out();
    d.warnings = false;
    d.burn = 0.5;
    for (let i = 0; i < 60; i++) t.update(w, 1 / 60, d);
    expect(played).toContain('crackle');
    expect(played).not.toContain('heartbeat');
  });
});
