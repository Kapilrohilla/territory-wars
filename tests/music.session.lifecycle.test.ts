import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicPlayer } from '../src/game/music/player';
import { getTranspose, setTranspose } from '../src/game/sound';

/** A canvas 2D context that accepts any call. */
const ctx2d: unknown = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => ctx2d), set: () => true });
const canvas = () => ({
  getContext: () => ctx2d,
  addEventListener() {}, removeEventListener() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  style: {}, width: 800, height: 600, setPointerCapture() {}, releasePointerCapture() {},
}) as unknown as HTMLCanvasElement;

function stubMusic() {
  const calls: string[] = [];
  const m: MusicPlayer = {
    start() { calls.push('start'); setTranspose(-3); },
    pause() { calls.push('pause'); },
    resume() { calls.push('resume'); },
    dispose() { calls.push('dispose'); setTranspose(0); },
    setMood() {},
    events(list) { for (const x of list) calls.push(`e:${x.e}`); },
    playing: false,
  };
  return { m, calls };
}

let raf: ((t: number) => void) | null = null;
beforeEach(() => {
  const noop = () => {};
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, addEventListener: noop, removeEventListener: noop });
  vi.stubGlobal('document', {
    documentElement: { classList: { contains: () => false } },
    createElement: () => canvas(),
    addEventListener: noop, removeEventListener: noop,
  });
  vi.stubGlobal('Path2D', function () { return new Proxy({}, { get: () => () => {} }); });
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => { raf = f; return 1; });
  vi.stubGlobal('cancelAnimationFrame', noop);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setTranspose(0); });

describe('session drives music', () => {
  it('session_pause_resume_dispose_drive_music', async () => {
    const { createSession } = await import('../src/game/session');
    const { m, calls } = stubMusic();
    const s = createSession(canvas(), { seed: 1, music: m });
    expect(s.music).toBe(m);
    s.start();
    expect(s.pause()).toBe(true);
    s.resume();
    s.dispose();
    s.dispose();
    expect(calls.filter((c) => !c.startsWith('e:'))).toEqual(['start', 'pause', 'resume', 'dispose']);
    expect(getTranspose()).toBe(0);
  });

  it('a declined revive ends the round with the music disposed and transpose back at 0', async () => {
    const { createSession } = await import('../src/game/session');
    const { m, calls } = stubMusic();
    let over = false;
    let transposeAtOver = NaN;
    const s = createSession(canvas(), { seed: 1, music: m, onOver: () => { over = true; transposeAtOver = getTranspose(); } });
    s.start();
    // Knock the human out with no input: run frames until the revive offer, then give up.
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const frame = () => { t += 16; const f = raf; raf = null; f?.(t); };
    for (let i = 0; i < 20000 && !s.world.awaitingRevive && !s.world.over; i++) frame();
    if (s.world.awaitingRevive) s.giveUp();
    for (let i = 0; i < 2000 && !over; i++) frame();
    expect(over).toBe(true);
    expect(calls).toContain('e:down');
    expect(calls).toContain('e:gameover');
    expect(calls).toContain('dispose');
    expect(transposeAtOver).toBe(0); // already reset when the results screen is shown
    expect(getTranspose()).toBe(0);
    s.dispose();
  });
});
