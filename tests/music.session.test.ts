import { describe, expect, it } from 'vitest';
import { musicEventsFor } from '../src/game/music/fromCues';

describe('musicEventsFor', () => {
  it('music_events_from_cues: steal carries the capture pct and replaces the capture', () => {
    const out = musicEventsFor([
      { name: 'steal' },
      { name: 'capture', pct: 3.5, delay: 0.07 },
      { name: 'escape', delay: 0.19 },
    ]);
    expect(out).toEqual([{ e: 'steal', size: 3.5 }, { e: 'escape' }]);
  });

  it('a lone capture is a capture; a kill carries its streak', () => {
    expect(musicEventsFor([{ name: 'capture', pct: 1 }])).toEqual([{ e: 'capture' }]);
    expect(musicEventsFor([{ name: 'kill', streak: 2 }])).toEqual([{ e: 'kill', size: 2 }]);
    expect(musicEventsFor([{ name: 'kill' }])).toEqual([{ e: 'kill', size: 0 }]);
  });

  it('keeps milestone, down, revive, win and gameover; drops the rest', () => {
    const names = ['milestone', 'down', 'revive', 'win', 'gameover'] as const;
    expect(musicEventsFor(names.map((name) => ({ name })))).toEqual(names.map((e) => ({ e })));
    expect(musicEventsFor([{ name: 'heartbeat' }, { name: 'alert' }, { name: 'burning' }, { name: 'cut' }])).toEqual([]);
  });
});
