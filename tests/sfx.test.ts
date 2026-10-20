import { describe, expect, it } from 'vitest';
import { soundsFor } from '../src/game/sfxEvents';
import { createWorld } from '../src/sim/world';
import type { GameEvent } from '../src/sim/types';

const w = createWorld({ seed: 1, humanName: 'You', humanColor: 0 }); // human is id 0
const none: GameEvent['type'][] = [];

describe('soundsFor', () => {
  it('plays capture only for the human gaining land', () => {
    expect(soundsFor([{ type: 'capture', playerId: 0, gainedPct: 0.4, region: [] }], w)).toEqual(['capture']);
    expect(soundsFor([{ type: 'capture', playerId: 3, gainedPct: 0.4, region: [] }], w)).toEqual(none);
    expect(soundsFor([{ type: 'capture', playerId: 0, gainedPct: 0, region: [] }], w)).toEqual(none);
  });

  it('cut: swish when you cut, warning when you are cut, silent between bots', () => {
    expect(soundsFor([{ type: 'cut', hitterId: 0, victimId: 2 }], w)).toEqual(['cut']);
    expect(soundsFor([{ type: 'cut', hitterId: 2, victimId: 0 }], w)).toEqual(['burning']);
    expect(soundsFor([{ type: 'cut', hitterId: 2, victimId: 3 }], w)).toEqual(none);
  });

  it('kill only when the human knocks out a rival', () => {
    expect(soundsFor([{ type: 'death', playerId: 4, killerId: 0, cause: 'trail' }], w)).toEqual(['kill']);
    expect(soundsFor([{ type: 'death', playerId: 4, killerId: 5, cause: 'trail' }], w)).toEqual(none);
    expect(soundsFor([{ type: 'death', playerId: 0, killerId: 5, cause: 'trail' }], w)).toEqual(none);
  });

  it('dedupes within a step', () => {
    expect(soundsFor([
      { type: 'death', playerId: 4, killerId: 0, cause: 'trail' },
      { type: 'death', playerId: 6, killerId: 0, cause: 'captured' },
      { type: 'capture', playerId: 0, gainedPct: 1, region: [] },
    ], w)).toEqual(['kill', 'capture']);
  });

  it('down, win and gameover drown out other sounds in the same step', () => {
    const kill: GameEvent = { type: 'death', playerId: 4, killerId: 0, cause: 'headon' };
    expect(soundsFor([kill, { type: 'down', playerId: 0, killerId: 4, cause: 'headon' }], w)).toEqual(['down']);
    expect(soundsFor([kill, { type: 'win' }], w)).toEqual(['win']);
    expect(soundsFor([kill, { type: 'gameover' }], w)).toEqual(['gameover']);
  });
});
