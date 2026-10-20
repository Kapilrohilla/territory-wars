import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playSound, setMuted, unlockAudio, type SoundName } from '../src/game/sound';

/** Records every gain envelope a sound schedules, so peaks and ramps can be checked. */
type Call = { kind: string; v: number; t: number };
class FakeParam {
  value = 1;
  calls: Call[] = [];
  setValueAtTime(v: number, t: number) { this.calls.push({ kind: 'set', v, t }); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'lin', v, t }); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push({ kind: 'exp', v, t }); }
  setTargetAtTime(v: number, t: number) { this.calls.push({ kind: 'target', v, t }); }
}
class FakeNode {
  connect() {}
  disconnect() {}
}
const gains: FakeParam[] = [];
let starts: number[] = [];
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = '';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start(t: number) { starts.push(t); }
  stop() {}
}
class FakeCtx {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  resume() { return Promise.resolve(); }
  createGain() {
    const n = Object.assign(new FakeNode(), { gain: new FakeParam() });
    gains.push(n.gain);
    return n;
  }
  createOscillator() { return new FakeSource(); }
  createBufferSource() { return new FakeSource(); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }); }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
}

const ALL: SoundName[] = ['capture', 'steal', 'cut', 'kill', 'burning', 'escape', 'down', 'revive',
  'shieldDown', 'milestone', 'start', 'win', 'gameover', 'newBest'];

/** Envelopes (gain params ramped by a voice) scheduled while running fn. */
function envelopes(fn: () => void): FakeParam[] {
  gains.length = 0;
  starts = [];
  fn();
  return gains.filter((g) => g.calls.some((c) => c.kind === 'lin'));
}

describe('sound', () => {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const saved = g.AudioContext;
  beforeAll(() => {
    g.AudioContext = FakeCtx;
    unlockAudio();
  });
  afterAll(() => { g.AudioContext = saved; });

  it.each(ALL)('%s: every voice ramps in from silence, peaks under 0.1 and fades out', (name) => {
    const env = envelopes(() => playSound(name, { pct: 5, streak: 4, tier: 2 }));
    expect(env.length).toBeGreaterThan(0);
    for (const p of env) {
      const [first, ...rest] = p.calls;
      expect(first).toMatchObject({ kind: 'set', v: 0.0001 });
      const attack = rest.find((c) => c.kind === 'lin')!;
      expect(attack.t).toBeGreaterThan(first.t); // a real attack ramp, no instant jump
      expect(Math.max(...p.calls.map((c) => c.v))).toBeLessThan(0.1);
      expect(rest[rest.length - 1]).toMatchObject({ kind: 'exp', v: 0.0001 });
    }
  });

  it('a bigger capture plays more notes', () => {
    const small = envelopes(() => playSound('capture', { pct: 0.3 })).length;
    const mid = envelopes(() => playSound('capture', { pct: 2 })).length;
    const big = envelopes(() => playSound('capture', { pct: 4 })).length;
    expect(small).toBeLessThan(mid);
    expect(mid).toBeLessThan(big);
  });

  it('delay shifts every voice later', () => {
    envelopes(() => playSound('capture', { pct: 2 }));
    const base = Math.min(...starts);
    envelopes(() => playSound('capture', { pct: 2, delay: 0.25 }));
    expect(Math.min(...starts)).toBeCloseTo(base + 0.25, 9);
  });

  it('muted plays nothing', () => {
    setMuted(true);
    try {
      expect(envelopes(() => ALL.forEach((n) => playSound(n)))).toEqual([]);
    } finally {
      setMuted(false);
    }
  });
});
