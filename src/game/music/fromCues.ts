import type { Cue } from '../sfxEvents';
import type { MusicEvent } from './composer';

/**
 * The music events one step's sound cues stand for. A steal carries the same step's capture
 * share as its size and replaces that capture; a kill carries its streak. Cues the music
 * has no use for (heartbeat, alert, burning, ...) are dropped.
 */
export function musicEventsFor(cues: Cue[]): { e: MusicEvent; size?: number }[] {
  const out: { e: MusicEvent; size?: number }[] = [];
  const stole = cues.some((c) => c.name === 'steal');
  const capturePct = cues.find((c) => c.name === 'capture')?.pct ?? 0;
  for (const c of cues) {
    switch (c.name) {
      case 'steal': out.push({ e: 'steal', size: capturePct }); break;
      case 'capture': if (!stole) out.push({ e: 'capture' }); break;
      case 'kill': out.push({ e: 'kill', size: c.streak ?? 0 }); break;
      case 'escape': case 'milestone': case 'down': case 'revive': case 'win': case 'gameover':
        out.push({ e: c.name }); break;
    }
  }
  return out;
}
