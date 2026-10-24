import { describe, expect, it } from 'vitest';
import { createSfxState, soundsFor, STREAK_WINDOW_S, type Cue, type SfxState } from '../src/game/sfxEvents';
import { waveSeconds } from '../src/game/waves';
import { captureNotes, MAX_STREAK, STREAK_STEPS } from '../src/game/sound';
import { createWorld } from '../src/sim/world';
import { circleRing } from '../src/sim/geometry';
import { CONFIG } from '../src/sim/config';
import type { DeathCause, GameEvent, Stolen, World } from '../src/sim/types';

const newWorld = () => createWorld({ seed: 1, humanName: 'You', humanColor: 0 }); // human is id 0
const w = newWorld();
const names = (cues: Cue[]) => cues.map((c) => c.name);
const none: string[] = [];
/** One-shot call with fresh state, for rules that don't depend on history. */
const once = (events: GameEvent[], world: World = w) => names(soundsFor(events, world, createSfxState()));

const cap = (playerId: number, gainedPct: number, stolen: Stolen[] = []): GameEvent =>
  ({ type: 'capture', playerId, gainedPct, region: [], stolen });
const killBy = (killerId: number, playerId: number, cause: DeathCause = 'trail'): GameEvent =>
  ({ type: 'death', playerId, killerId, cause });

/** Gives the human a disk of land worth `share` % of the arena. */
function setHumanPct(world: World, share: number) {
  const r = Math.sqrt(share / 100) * CONFIG.ARENA_R;
  world.players[world.humanId].land = [[circleRing({ x: 0, y: 0 }, r, 256)]];
}

describe('soundsFor', () => {
  it('plays capture only for the human gaining land, carrying the gain', () => {
    const hp = w.players[w.humanId].pos;
    expect(soundsFor([cap(0, 0.4)], w, createSfxState())).toEqual([{ name: 'capture', pct: 0.4, delay: 0, durationS: waveSeconds(0), at: { x: hp.x, y: hp.y } }]);
    expect(once([cap(3, 0.4)])).toEqual(none);
    expect(once([cap(0, 0)])).toEqual(none);
  });

  it('steal swipe comes before the capture chord, which waits for it', () => {
    const cues = soundsFor([cap(0, 2, [{ playerId: 3, pct: 0.5 }])], w, createSfxState());
    expect(names(cues)).toEqual(['steal', 'capture']);
    expect(cues[0].delay ?? 0).toBe(0);
    expect(cues[1].delay).toBeGreaterThan(0);
    expect(cues[1].pct).toBe(2);
  });

  it('no steal for empty ground, nor for a bot stealing from a bot', () => {
    expect(once([cap(0, 2, [])])).toEqual(['capture']);
    expect(once([cap(2, 2, [{ playerId: 3, pct: 1 }])])).toEqual(none);
  });

  it('a bot stealing from the human is silent', () => {
    expect(once([cap(2, 2, [{ playerId: 0, pct: 1 }])])).toEqual(none);
  });

  it('escape: a chime for the human, after the capture chord; silent for bots', () => {
    const cues = soundsFor([cap(0, 0.5), { type: 'escape', playerId: 0 }], w, createSfxState());
    expect(names(cues)).toEqual(['capture', 'escape']);
    expect(cues[1].delay).toBeGreaterThan(cues[0].delay ?? 0);
    expect(once([cap(4, 0.5), { type: 'escape', playerId: 4 }])).toEqual(none);
  });

  it('escape after a steal still follows the chord', () => {
    const cues = soundsFor([cap(0, 1, [{ playerId: 3, pct: 0.2 }]), { type: 'escape', playerId: 0 }], w, createSfxState());
    expect(names(cues)).toEqual(['steal', 'capture', 'escape']);
    expect(cues[2].delay).toBeGreaterThan(cues[1].delay!);
  });

  it('cut: swish when you cut, warning when you are cut, silent between bots', () => {
    expect(once([{ type: 'cut', hitterId: 0, victimId: 2 }])).toEqual(['cut']);
    expect(once([{ type: 'cut', hitterId: 2, victimId: 0 }])).toEqual(['burning']);
    expect(once([{ type: 'cut', hitterId: 2, victimId: 3 }])).toEqual(none);
  });

  it('positions cues in the world: capture, cut and burning at the head, kill at the victim', () => {
    const world = newWorld();
    const h = world.players[0];
    h.pos = { x: 3, y: -4 };
    world.players[4].pos = { x: 20, y: 7 };
    const at = (events: GameEvent[]) => soundsFor(events, world, createSfxState())[0].at;
    expect(at([cap(0, 1)])).toEqual({ x: 3, y: -4 });
    expect(at([{ type: 'cut', hitterId: 0, victimId: 2 }])).toEqual({ x: 3, y: -4 });
    expect(at([{ type: 'cut', hitterId: 2, victimId: 0 }])).toEqual({ x: 3, y: -4 });
    expect(at([killBy(0, 4)])).toEqual({ x: 20, y: 7 });
    // A copy, not the live (mutating) position.
    expect(at([cap(0, 1)])).not.toBe(h.pos);
    expect(soundsFor([{ type: 'win' }], world, createSfxState())[0].at).toBeUndefined();
  });

  it('kill only when the human knocks out a rival', () => {
    expect(once([killBy(0, 4)])).toEqual(['kill']);
    expect(once([killBy(5, 4)])).toEqual(none);
    expect(once([killBy(5, 0)])).toEqual(none);
  });

  it('dedupes within a step', () => {
    expect(once([killBy(0, 4), killBy(0, 6, 'captured'), cap(0, 1)])).toEqual(['kill', 'capture']);
  });

  it('down, win and gameover drown out other sounds in the same step', () => {
    const kill = killBy(0, 4, 'headon');
    const c = cap(0, 2, [{ playerId: 4, pct: 1 }]);
    expect(once([kill, c, { type: 'down', playerId: 0, killerId: 4, cause: 'headon' }])).toEqual(['down']);
    expect(once([kill, c, { type: 'win' }])).toEqual(['win']);
    expect(once([kill, c, { type: 'gameover' }])).toEqual(['gameover']);
    // Priority among the three: win, then down, then gameover.
    expect(once([{ type: 'gameover' }, { type: 'down', playerId: 0, killerId: null, cause: 'self' }])).toEqual(['down']);
    expect(once([{ type: 'gameover' }, { type: 'win' }])).toEqual(['win']);
  });
});

describe('kill streaks', () => {
  function killAt(world: World, s: SfxState, time: number, n = 1) {
    world.time = time;
    const events = Array.from({ length: n }, (_, i) => killBy(0, 1 + i));
    return soundsFor(events, world, s).find((c) => c.name === 'kill')?.streak;
  }

  it('each kill within the window climbs one step, capped at the top', () => {
    const world = newWorld();
    const s = createSfxState();
    const t0 = 10;
    const steps = [0, 1, 2, 3, 4, 5, 6].map((i) => killAt(world, s, t0 + i * 3));
    expect(steps).toEqual([0, 1, 2, 3, 4, 4, 4]);
    expect(MAX_STREAK).toBe(4);
    expect(STREAK_STEPS).toHaveLength(5);
  });

  it('the window is measured from the previous kill, inclusive', () => {
    const world = newWorld();
    const s = createSfxState();
    expect(killAt(world, s, 5)).toBe(0);
    expect(killAt(world, s, 5 + STREAK_WINDOW_S)).toBe(1);
    expect(killAt(world, s, 5 + 2 * STREAK_WINDOW_S)).toBe(2);
  });

  it('a gap longer than the window starts over', () => {
    const world = newWorld();
    const s = createSfxState();
    killAt(world, s, 1);
    expect(killAt(world, s, 4)).toBe(1);
    expect(killAt(world, s, 4 + STREAK_WINDOW_S + 0.1)).toBe(0);
    expect(killAt(world, s, 6 + STREAK_WINDOW_S)).toBe(1);
  });

  it('several kills in one step all count, but play one chirp at the peak', () => {
    const world = newWorld();
    const s = createSfxState();
    world.time = 3;
    const cues = soundsFor([killBy(0, 1), killBy(0, 2), killBy(0, 3)], world, s);
    const v = world.players[3].pos;
    expect(cues).toEqual([{ name: 'kill', streak: 2, at: { x: v.x, y: v.y } }]);
  });

  it('bot kills do not touch the streak', () => {
    const world = newWorld();
    const s = createSfxState();
    killAt(world, s, 1);
    world.time = 2;
    soundsFor([killBy(3, 4)], world, s);
    expect(s.streak).toBe(0);
    expect(killAt(world, s, 3)).toBe(1);
  });
});

describe('capture sweep length', () => {
  it('matches the wave of the largest region the human captured this step', () => {
    const sq = (side: number): GameEvent => ({
      type: 'capture', playerId: 0, gainedPct: 1, stolen: [],
      region: [[[{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }]]],
    });
    const cue = soundsFor([sq(10), sq(30)], w, createSfxState()).find((c) => c.name === 'capture');
    expect(cue?.durationS).toBeCloseTo(waveSeconds(900), 9);
  });

  it("an absorbed victim's land counts too", () => {
    const region = [[[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]]];
    const cue = soundsFor([{ type: 'absorb', playerId: 0, victimId: 2, gainedPct: 2, region }], w, createSfxState())
      .find((c) => c.name === 'capture');
    expect(cue?.durationS).toBeCloseTo(waveSeconds(400), 9);
  });
});

describe('milestones', () => {
  it('each of 10 / 25 / 50 % plays once, on the capture that passes it', () => {
    const world = newWorld();
    const s = createSfxState();
    const step = (share: number) => {
      setHumanPct(world, share);
      return soundsFor([cap(0, 0.5)], world, s).find((c) => c.name === 'milestone');
    };
    expect(step(5)).toBeUndefined();
    expect(step(10.5)?.tier).toBe(0);
    expect(step(12)).toBeUndefined();
    expect(step(26)?.tier).toBe(1);
    expect(step(30)).toBeUndefined();
    expect(step(51)?.tier).toBe(2);
    expect(step(60)).toBeUndefined();
  });

  it('falling back under a mark and passing it again stays quiet', () => {
    const world = newWorld();
    const s = createSfxState();
    setHumanPct(world, 11);
    expect(names(soundsFor([cap(0, 1)], world, s))).toContain('milestone');
    setHumanPct(world, 8);
    soundsFor([], world, s);
    setHumanPct(world, 11);
    expect(names(soundsFor([cap(0, 1)], world, s))).not.toContain('milestone');
  });

  it('jumping past two marks plays only the higher one, and spends both', () => {
    const world = newWorld();
    const s = createSfxState();
    setHumanPct(world, 27);
    const m = soundsFor([cap(0, 20)], world, s).filter((c) => c.name === 'milestone');
    expect(m).toHaveLength(1);
    expect(m[0].tier).toBe(1);
    expect(s.milestones).toBe(2);
  });

  it('only a human capture checks milestones, and the fanfare comes after the chord', () => {
    const world = newWorld();
    const s = createSfxState();
    setHumanPct(world, 11);
    expect(soundsFor([cap(2, 3)], world, s)).toEqual([]);
    const cues = soundsFor([cap(0, 1)], world, s);
    expect(names(cues)).toEqual(['capture', 'milestone']);
    expect(cues[1].delay).toBeGreaterThan(cues[0].delay ?? 0);
  });

  it('a fresh state (new round) earns them again', () => {
    const world = newWorld();
    setHumanPct(world, 11);
    soundsFor([cap(0, 1)], world, createSfxState());
    expect(names(soundsFor([cap(0, 1)], world, createSfxState()))).toContain('milestone');
  });

  it('a winning capture plays only the win', () => {
    const world = newWorld();
    setHumanPct(world, 55);
    expect(once([cap(0, 5), { type: 'win' }], world)).toEqual(['win']);
  });
});

describe('revive shield', () => {
  it('power-up when protectedUntil jumps, power-down once when the shield ends', () => {
    const world = newWorld();
    const s = createSfxState();
    const h = world.players[0];
    world.time = 20;
    expect(soundsFor([], world, s)).toEqual([]);
    h.protectedUntil = world.time + CONFIG.REVIVE_PROTECT_S;
    expect(soundsFor([], world, s)).toEqual([{ name: 'revive' }]);
    world.time = 21;
    expect(soundsFor([], world, s)).toEqual([]);
    world.time = 22;
    expect(soundsFor([], world, s)).toEqual([{ name: 'shieldDown' }]);
    world.time = 23;
    expect(soundsFor([], world, s)).toEqual([]);
  });

  it('the revive resets the kill streak', () => {
    const world = newWorld();
    const s = createSfxState();
    world.time = 1;
    soundsFor([killBy(0, 1)], world, s);
    world.time = 2;
    world.players[0].protectedUntil = 4;
    soundsFor([], world, s);
    world.time = 3;
    expect(soundsFor([killBy(0, 2)], world, s)).toContainEqual(expect.objectContaining({ name: 'kill', streak: 0 }));
  });

  it('no power-down when the human is not alive as the shield ends', () => {
    const world = newWorld();
    const s = createSfxState();
    world.players[0].protectedUntil = 2;
    soundsFor([], world, s);
    world.time = 2;
    world.players[0].alive = false;
    expect(soundsFor([{ type: 'gameover' }], world, s)).toEqual([{ name: 'gameover' }]);
    expect(s.shielded).toBe(false);
  });
});

describe('captureNotes', () => {
  it('grows from one soft note to a rising three-note run above 3 %', () => {
    expect(captureNotes(0.2)).toHaveLength(1);
    expect(captureNotes(1.5)).toHaveLength(2);
    expect(captureNotes(3)).toHaveLength(2);
    const big = captureNotes(3.01);
    expect(big).toHaveLength(3);
    expect([...big].sort((a, b) => a - b)).toEqual(big);
  });
});
