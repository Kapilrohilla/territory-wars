import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMaster, playSound, setMuted, unlockAudio, type SoundName } from '../src/game/sound';

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
const oscs: FakeSource[] = [];
const filters: { frequency: FakeParam }[] = [];
/** First scheduled frequency of each oscillator and filter created while running fn. */
function freqs(fn: () => void): { osc: number[]; filter: number[]; glides: number[] } {
  oscs.length = 0;
  filters.length = 0;
  fn();
  const f0 = (p: FakeParam) => p.calls.find((c) => c.kind === 'set')?.v ?? p.value;
  return {
    osc: oscs.map((o) => f0(o.frequency)),
    filter: filters.map((f) => f0(f.frequency)),
    glides: oscs.filter((o) => o.frequency.calls.some((c) => c.kind === 'exp')).map((o) => f0(o.frequency)),
  };
}
const peak = (env: FakeParam[]) => Math.max(...env.flatMap((p) => p.calls.map((c) => c.v)));
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
  createOscillator() { const o = new FakeSource(); oscs.push(o); return o; }
  createBufferSource() { return new FakeSource(); }
  createBiquadFilter() {
    const f = Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() });
    filters.push(f);
    return f;
  }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
}

const ALL: SoundName[] = ['capture', 'steal', 'cut', 'kill', 'burning', 'escape', 'down', 'revive',
  'shieldDown', 'milestone', 'start', 'win', 'gameover', 'newBest', 'heartbeat', 'crackle', 'alert', 'overtake'];

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

  it('heartbeat: a steady low thump plus an audible 150–300 Hz layer for phone speakers', () => {
    const f = freqs(() => playSound('heartbeat', { gain: 0.05 }));
    expect(f.osc.some((hz) => hz < 70)).toBe(true); // body
    expect(f.glides.filter((hz) => hz < 100)).toEqual([]); // the low thump doesn't glide down
    expect([...f.osc, ...f.filter].some((hz) => hz >= 150 && hz <= 300)).toBe(true);
  });

  it('heartbeat loudness follows the gain it is given', () => {
    const soft = peak(envelopes(() => playSound('heartbeat', { gain: 0.02 })));
    const loud = peak(envelopes(() => playSound('heartbeat', { gain: 0.08 })));
    expect(loud).toBeGreaterThan(soft * 2);
  });

  it('crackle is loud enough to register over gameplay, in a phone-friendly band', () => {
    expect(peak(envelopes(() => playSound('crackle', { level: 0 })))).toBeGreaterThanOrEqual(0.04);
    const f = freqs(() => playSound('crackle', { level: 1 }));
    for (const hz of f.filter) { expect(hz).toBeGreaterThanOrEqual(1000); expect(hz).toBeLessThanOrEqual(5000); }
  });

  it('alert: a short two-note blip, every partial in the phone-speaker band', () => {
    const f = freqs(() => playSound('alert'));
    expect(new Set(f.osc.map((hz) => Math.round(hz))).size).toBeGreaterThanOrEqual(2);
    for (const hz of [...f.osc, ...f.filter]) {
      expect(hz).toBeGreaterThanOrEqual(150);
      expect(hz).toBeLessThanOrEqual(4000);
    }
    envelopes(() => playSound('alert'));
    expect(new Set(starts).size).toBe(2); // two notes, one after the other
    expect(Math.max(...starts)).toBeLessThan(0.2);
  });

  it('muted plays nothing', () => {
    setMuted(true);
    try {
      expect(envelopes(() => ALL.forEach((n) => playSound(n)))).toEqual([]);
    } finally {
      setMuted(false);
    }
  });

  it('overtake: a short soft rising tick in the phone-speaker band', () => {
    const f = freqs(() => playSound('overtake'));
    for (const hz of [...f.osc, ...f.filter]) {
      expect(hz).toBeGreaterThanOrEqual(150);
      expect(hz).toBeLessThanOrEqual(4000);
    }
    envelopes(() => playSound('overtake'));
    expect(Math.max(...starts)).toBeLessThan(0.15);
    expect(peak(envelopes(() => playSound('overtake')))).toBeLessThanOrEqual(0.07);
    expect(f.osc[f.osc.length - 1]).toBeGreaterThan(f.osc[0]); // rising
  });

  it('master chain: a gentle limiter before the speakers, straight through without one', () => {
    const links: [string, string][] = [];
    const node = <T extends object>(name: string, extra: T = {} as T) =>
      Object.assign({ name, connect: (to: { name: string }) => { links.push([name, to.name]); } }, extra);
    const param = () => ({ value: 0 });
    const comp = node('limiter', { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    const withComp = { destination: node('out'), createDynamicsCompressor: () => comp };
    const master = node('master');
    const got = connectMaster(withComp as unknown as AudioContext, master as unknown as GainNode);
    expect(got).toBe(comp);
    expect(links).toEqual([['master', 'limiter'], ['limiter', 'out']]);
    expect(comp.threshold.value).toBe(-10);
    expect(comp.knee.value).toBe(6);
    expect(comp.ratio.value).toBe(4);
    expect(comp.attack.value).toBeCloseTo(0.003, 9);
    expect(comp.release.value).toBeCloseTo(0.15, 9);

    links.length = 0;
    const bare = { destination: node('out') }; // no createDynamicsCompressor (old engines, mocks)
    expect(connectMaster(bare as unknown as AudioContext, master as unknown as GainNode)).toBeNull();
    expect(links).toEqual([['master', 'out']]);
  });
});
