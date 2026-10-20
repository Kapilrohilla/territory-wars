import { describe, it, expect } from 'vitest';
import { botSkin, DEFAULT_SKIN, faceFor, MOODS, SKINS, skinById } from '../src/game/skins';
import { createMoodState, moodEvents, moodOf, MOOD_SECONDS } from '../src/game/moods';
import type { GameEvent, World } from '../src/sim/types';

describe('skins', () => {
  it('has unique ids and a free default', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(skinById(DEFAULT_SKIN).unlock.kind).toBe('free');
    expect(skinById('nope').id).toBe(SKINS[0].id);
  });

  it('applies shared mood changes over the base face', () => {
    const classic = skinById('classic');
    expect(faceFor(classic, 'idle')).toEqual(classic.face);
    expect(faceFor(classic, 'happy')).toMatchObject({ eyes: 'happy', mouth: 'grin' });
    expect(faceFor(classic, 'ko')).toMatchObject({ eyes: 'x', mouth: 'o' });
  });

  it('keeps locked parts and adds mood extras to the skin extras', () => {
    const cool = skinById('cool');
    expect(faceFor(cool, 'scared').eyes).toBe('shades');
    expect(faceFor(cool, 'scared').extras).toContain('sweat');
    const kitty = faceFor(skinById('kitty'), 'scared');
    expect(kitty.extras).toEqual(expect.arrayContaining(['ears', 'whiskers', 'sweat']));
  });

  it('lets a skin override a mood after the shared change', () => {
    expect(faceFor(skinById('grumpy'), 'happy')).toMatchObject({ eyes: 'happy', mouth: 'flat' });
  });

  it('gives every skin a face in every mood', () => {
    for (const s of SKINS) for (const m of MOODS) expect(faceFor(s, m).eyes).toBeTruthy();
  });

  it('picks bot skins deterministically', () => {
    expect(botSkin(3, 42)).toBe(botSkin(3, 42));
    const ids = new Set(Array.from({ length: 12 }, (_, i) => botSkin(i + 1, 7).id));
    expect(ids.size).toBeGreaterThan(3);
  });
});

describe('moods', () => {
  const world = (time: number, awaitingRevive = false) => ({ time, awaitingRevive }) as Pick<World, 'time' | 'awaitingRevive'>;
  const p = (id: number, over: Partial<{ alive: boolean; burn: unknown; isHuman: boolean }> = {}) =>
    ({ id, alive: true, burn: null, isHuman: false, ...over }) as Parameters<typeof moodOf>[0];
  const capture = (playerId: number): GameEvent => ({ type: 'capture', playerId, gainedPct: 1, region: [], stolen: [] });

  it('is happy after a capture, until it wears off', () => {
    const st = createMoodState();
    moodEvents([capture(1)], { time: 10 } as World, st);
    expect(moodOf(p(1), world(10.5), st)).toBe('happy');
    expect(moodOf(p(1), world(10 + MOOD_SECONDS.happy + 0.01), st)).toBe('idle');
  });

  it('is fierce after a cut or a kill, and a kill beats a capture', () => {
    const st = createMoodState();
    moodEvents([capture(2), { type: 'death', playerId: 5, killerId: 2, cause: 'trail' }], { time: 3 } as World, st);
    expect(moodOf(p(2), world(3.1), st)).toBe('fierce');
    moodEvents([capture(2)], { time: 3.2 } as World, st);
    expect(moodOf(p(2), world(3.3), st)).toBe('fierce');
    moodEvents([{ type: 'cut', hitterId: 4, victimId: 1 }], { time: 1 } as World, st);
    expect(moodOf(p(4), world(1.2), st)).toBe('fierce');
  });

  it('shows scared while burning and ko when down', () => {
    const st = createMoodState();
    moodEvents([capture(1)], { time: 0 } as World, st);
    expect(moodOf(p(1, { burn: {} }), world(0.1), st)).toBe('scared');
    expect(moodOf(p(1, { alive: false }), world(0.1), st)).toBe('ko');
    expect(moodOf(p(0, { isHuman: true }), world(0.1, true), st)).toBe('ko');
  });

  it('ignores self-kills for the fierce mood', () => {
    const st = createMoodState();
    moodEvents([{ type: 'death', playerId: 3, killerId: 3, cause: 'self' }], { time: 0 } as World, st);
    expect(moodOf(p(3), world(0.1), st)).toBe('idle');
  });
});
