import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  distanceGain, isDirectional, masterLevel, panFor, playSound, setDirectional, setListener, setMuted, setVolume,
  spatialFor, unlockAudio, volumeToGain, MASTER_GAIN,
} from '../src/game/sound';
import type { Vec } from '../src/sim/geometry';

describe('panFor', () => {
  it('is 0 at the centre and ±0.7 at the edges', () => {
    expect(panFor(200, 400)).toBeCloseTo(0, 9);
    expect(panFor(0, 400)).toBeCloseTo(-0.7, 9);
    expect(panFor(400, 400)).toBeCloseTo(0.7, 9);
    expect(panFor(300, 400)).toBeCloseTo(0.35, 9);
  });

  it('is clamped far off-screen', () => {
    expect(panFor(-5000, 400)).toBeCloseTo(-0.7, 9);
    expect(panFor(9000, 400)).toBeCloseTo(0.7, 9);
  });

  it('is 0 for a degenerate width or a non-finite x', () => {
    expect(panFor(10, 0)).toBe(0);
    expect(panFor(Number.NaN, 400)).toBe(0);
  });
});

describe('distanceGain', () => {
  it('is clamp01(1.4 − d/60)', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(24)).toBeCloseTo(1, 9);
    expect(distanceGain(54)).toBeCloseTo(0.5, 9);
    expect(distanceGain(84)).toBeCloseTo(0, 9);
    expect(distanceGain(500)).toBe(0);
  });
});

describe('volumeToGain', () => {
  it('maps 0–100 linearly to 0–1, clamped', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(50)).toBeCloseTo(0.5, 9);
    expect(volumeToGain(80)).toBeCloseTo(0.8, 9);
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(140)).toBe(1);
    expect(volumeToGain(-3)).toBe(0);
    expect(volumeToGain(Number.NaN)).toBe(0.8);
  });
});

/** A 400×300 view centred on the world origin at 10 px per unit. */
const view = {
  viewW: 400,
  viewH: 300,
  worldToScreen: (p: Vec) => ({ x: p.x * 10 + 200, y: p.y * 10 + 150 }),
};
const head = { x: 0, y: 0 };

describe('spatialFor', () => {
  it('pans by screen x and leaves on-screen events at full gain', () => {
    const s = spatialFor({ x: 10, y: 0 }, view, head, true);
    expect(s.pan).toBeCloseTo(0.35, 9);
    expect(s.gain).toBe(1);
  });

  it('attenuates off-screen events by world distance from the head', () => {
    const s = spatialFor({ x: -54, y: 0 }, view, head, true);
    expect(s.pan).toBeCloseTo(-0.7, 9);
    expect(s.gain).toBeCloseTo(0.5, 9);
  });

  it('directional off: centred, attenuation kept', () => {
    const s = spatialFor({ x: -54, y: 0 }, view, head, false);
    expect(s.pan).toBe(0);
    expect(s.gain).toBeCloseTo(0.5, 9);
  });
});

// ---------- the audio graph ----------

class FakeParam {
  value = 1;
  targets: number[] = [];
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime(v: number) { this.targets.push(v); this.value = v; }
}
class FakeNode {
  outs: unknown[] = [];
  connect(n: unknown) { this.outs.push(n); return n; }
  disconnect() {}
}
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  start() {}
  stop() {}
}
const gains: (FakeNode & { gain: FakeParam })[] = [];
const panners: (FakeNode & { pan: FakeParam })[] = [];
let withPanner = true;
class FakeCtx {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  resume() { return Promise.resolve(); }
  createGain() { const n = Object.assign(new FakeNode(), { gain: new FakeParam() }); gains.push(n); return n; }
  createOscillator() { return new FakeSource(); }
  createBufferSource() { return new FakeSource(); }
  createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() }); }
  createBuffer(_c: number, n: number) { const d = new Float32Array(n); return { getChannelData: () => d }; }
  createStereoPanner() {
    if (!withPanner) throw new Error('NotSupportedError');
    const n = Object.assign(new FakeNode(), { pan: new FakeParam() });
    panners.push(n);
    return n;
  }
}

describe('sound graph', () => {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const saved = g.AudioContext;
  beforeAll(() => {
    g.AudioContext = FakeCtx;
    unlockAudio();
  });
  afterAll(() => { g.AudioContext = saved; setListener(null); });
  beforeEach(() => {
    gains.length = 0;
    panners.length = 0;
    withPanner = true;
    setDirectional(true);
    setVolume(80);
    setMuted(false);
    setListener(view, () => head);
  });

  it('masterLevel is MASTER_GAIN, independent of the sound effects volume; mute still wins', () => {
    setVolume(50);
    expect(masterLevel()).toBe(MASTER_GAIN);
    setVolume(0);
    expect(masterLevel()).toBe(MASTER_GAIN);
    setMuted(true);
    expect(masterLevel()).toBe(0);
    setMuted(false);
    expect(masterLevel()).toBe(MASTER_GAIN);
  });

  it('a positioned cue goes through a stereo panner set from its screen x', () => {
    playSound('cut', { at: { x: 10, y: 0 } });
    expect(panners).toHaveLength(1);
    expect(panners[0].pan.value).toBeCloseTo(0.35, 9);
  });

  it('directional off: the panner sits at 0', () => {
    setDirectional(false);
    expect(isDirectional()).toBe(false);
    playSound('cut', { at: { x: 10, y: 0 } });
    expect(panners.every((p) => p.pan.value === 0)).toBe(true);
  });

  it('an off-screen cue is quieter by distance', () => {
    playSound('kill', { at: { x: 54, y: 0 } });
    const bus = gains.find((n) => n.outs.some((o) => panners.includes(o as never)));
    expect(bus?.gain.value).toBeCloseTo(0.5, 9);
  });

  it('a cue too far away is skipped', () => {
    playSound('kill', { at: { x: 500, y: 0 } });
    expect(gains).toHaveLength(0);
  });

  it('falls back without a panner (no throw) and still plays', () => {
    withPanner = false;
    expect(() => playSound('cut', { at: { x: 10, y: 0 } })).not.toThrow();
    expect(gains.length).toBeGreaterThan(0);
  });

  it('a cue without a position, or with no listener, plays straight to the master', () => {
    playSound('cut');
    expect(panners).toHaveLength(0);
    setListener(null);
    playSound('cut', { at: { x: 10, y: 0 } });
    expect(panners).toHaveLength(0);
  });
});
