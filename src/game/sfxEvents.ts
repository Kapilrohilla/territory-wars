import type { GameEvent, World } from '../sim/types';
import type { SoundName } from './sound';

/**
 * Which sounds one sim step's events should play, from the human's point of
 * view. Bot-vs-bot happenings stay silent so the soundscape stays readable.
 * At most one of each sound per step.
 */
export function soundsFor(events: GameEvent[], world: World): SoundName[] {
  const human = world.humanId;
  const out = new Set<SoundName>();
  for (const e of events) {
    switch (e.type) {
      case 'capture':
        if (e.playerId === human && e.gainedPct > 0) out.add('capture');
        break;
      case 'cut':
        if (e.hitterId === human) out.add('cut');
        else if (e.victimId === human) out.add('burning');
        break;
      case 'death':
        // The human's own final death is covered by 'down' / 'gameover'.
        if (e.playerId !== human && e.killerId === human) out.add('kill');
        break;
      case 'down':
        out.add('down');
        break;
      case 'win':
        out.add('win');
        break;
      case 'gameover':
        out.add('gameover');
        break;
    }
  }
  // A win or loss drowns out everything else in that step.
  if (out.has('win')) return ['win'];
  if (out.has('down')) return ['down'];
  if (out.has('gameover')) return ['gameover'];
  return [...out];
}
