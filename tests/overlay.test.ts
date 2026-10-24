import { afterEach, describe, expect, it } from 'vitest';
import {
  KNOB_MAX_PX, STEER_TIP_KEY, STEER_TIP_S, THREAT_TIP_S, createOverlay, createSteerTipState, createTipState,
  joyFade, knobOffset, placeArrow, placeTip, steerTipSeen, steerTipText, stepSteerTip, stepTip, tipSeen, type Rect,
} from '../src/game/overlay';
import { createDangerState, dangerWarningsEnabled } from '../src/game/danger';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const inside = (px: number, py: number, r: Rect, pad = 0) =>
  px > r.x - pad && px < r.x + r.w + pad && py > r.y - pad && py < r.y + r.h + pad;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('storage that throws', () => {
  const g = globalThis as { localStorage?: unknown };
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete g.localStorage;
  });
  const blockStorage = () => Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('SecurityError: storage blocked'); },
  });

  it('tipSeen, dangerWarningsEnabled and createOverlay do not throw', () => {
    blockStorage();
    expect(tipSeen()).toBe(false);
    expect(dangerWarningsEnabled()).toBe(true);
    expect(() => createOverlay(createDangerState())).not.toThrow();
  });

  it('a store whose getter throws reads as not seen', () => {
    expect(tipSeen({ getItem() { throw new Error('nope'); }, setItem() {} })).toBe(false);
  });
});

describe('placeArrow', () => {
  const out = { x: 0, y: 0 };
  // 400×800 viewport, centre (200, 400), chip centre kept 35 px inside, 20 px clearance.
  const W = 400, H = 800, INSET = 35, PAD = 20;

  it('pins to the edge where the line from the centre crosses it', () => {
    placeArrow(1, 0, W, H, INSET, PAD, [], out);
    expect(out).toEqual({ x: W - INSET, y: 400 });
    placeArrow(0, 1, W, H, INSET, PAD, [], out);
    expect(out).toEqual({ x: 200, y: H - INSET });
    placeArrow(-1, -1, W, H, INSET, PAD, [], out); // hits the left edge first (narrow screen)
    expect(out.x).toBeCloseTo(INSET, 9);
    expect(out.y).toBeCloseTo(400 - (200 - INSET), 9);
  });

  it('slides along the edge out of a HUD corner rect, to the nearer free side', () => {
    const minimap = rect(250, 640, 140, 150); // bottom-right
    placeArrow(1, 1.4, W, H, INSET, PAD, [], out); // lands under it without avoidance
    expect(inside(out.x, out.y, minimap, PAD)).toBe(true);
    placeArrow(1, 1.4, W, H, INSET, PAD, [minimap], out);
    expect(inside(out.x, out.y, minimap, PAD)).toBe(false);
    expect(out.x).toBeCloseTo(W - INSET, 9); // still on the right edge
    expect(out.y).toBeCloseTo(640 - PAD, 9); // slid up, just clear of it
  });

  it('slides the other way when the nearer side is off the edge', () => {
    const board = rect(220, 0, 180, 300); // top-right leaderboard
    placeArrow(1, -0.5, W, H, INSET, PAD, [board], out); // right edge at y ≈ 317.5
    expect(inside(out.x, out.y, board, PAD)).toBe(false);
    placeArrow(0.3, -1, W, H, INSET, PAD, [board], out); // top edge, under the board
    expect(inside(out.x, out.y, board, PAD)).toBe(false);
    expect(out.y).toBeCloseTo(INSET, 9);
    expect(out.x).toBeCloseTo(220 - PAD, 9); // slid left along the top edge
  });

  it('clears two rects on the same edge', () => {
    const a = rect(300, 600, 100, 200), b = rect(300, 520, 100, 70);
    placeArrow(1, 1, W, H, INSET, PAD, [a, b], out);
    expect(inside(out.x, out.y, a, PAD) || inside(out.x, out.y, b, PAD)).toBe(false);
  });

  describe('375×667 phone: the whole top edge sits under HUD cards', () => {
    const W2 = 375, H2 = 667, PAD2 = 25;
    // Area card top-left, pause button under it, leaderboard top-right (≤560px layout).
    const area = rect(12, 12, 169, 100), pause = rect(12, 124, 48, 48), board = rect(193, 12, 170, 180);
    const hud = [area, pause, board];
    const clear = (x: number, y: number) => hud.every((r) => !inside(x, y, r, PAD2));

    it('every top-edge spot is blocked (the old code stayed put under a card)', () => {
      for (let x = INSET; x <= W2 - INSET; x += 1) expect(clear(x, INSET)).toBe(false);
    });

    it('a ray just right of up moves to the right edge, just below the leaderboard', () => {
      placeArrow(0.2, -1, W2, H2, INSET, PAD2, hud, out);
      expect(clear(out.x, out.y)).toBe(true);
      expect(out.x).toBeCloseTo(W2 - INSET, 9);
      expect(out.y).toBeCloseTo(12 + 180 + PAD2, 9);
    });

    it('a ray just left of up moves to the left edge, below the area card and pause button', () => {
      placeArrow(-0.3, -1, W2, H2, INSET, PAD2, hud, out);
      expect(clear(out.x, out.y)).toBe(true);
      expect(out.x).toBeCloseTo(INSET, 9);
      expect(out.y).toBeCloseTo(124 + 48 + PAD2, 9);
    });

    it('stays inside the viewport and clear for every upward ray within ±40° of up', () => {
      for (let deg = -40; deg <= 40; deg += 2) {
        const a = (deg * Math.PI) / 180;
        placeArrow(Math.sin(a), -Math.cos(a), W2, H2, INSET, PAD2, hud, out);
        expect(clear(out.x, out.y)).toBe(true);
        expect(out.x).toBeGreaterThanOrEqual(INSET - 1e-9);
        expect(out.x).toBeLessThanOrEqual(W2 - INSET + 1e-9);
        expect(out.y).toBeGreaterThanOrEqual(INSET - 1e-9);
        expect(out.y).toBeLessThanOrEqual(H2 - INSET + 1e-9);
      }
    });
  });
});

describe('placeTip', () => {
  const out = { x: 0, y: 0 };
  const W = 400, H = 800, TW = 200, TH = 28, M = 8;

  it('stays on-screen', () => {
    placeTip(W - 40, 400, 0, TW, TH, W, H, M, 30, [], out);
    expect(out.x).toBeGreaterThanOrEqual(M);
    expect(out.x + TW).toBeLessThanOrEqual(W - M);
    expect(out.y).toBeGreaterThanOrEqual(M);
    expect(out.y + TH).toBeLessThanOrEqual(H - M);
  });

  it('keeps out of the avoid rects when it can', () => {
    const minimap = rect(250, 640, 140, 150), speaker = rect(10, 720, 60, 60);
    // Arrow on the bottom edge pointing down, near the minimap.
    placeTip(230, H - 35, Math.PI / 2, TW, TH, W, H, M, 30, [minimap, speaker], out);
    const tip = rect(out.x, out.y, TW, TH);
    expect(overlaps(tip, minimap)).toBe(false);
    expect(overlaps(tip, speaker)).toBe(false);
    expect(out.x).toBeGreaterThanOrEqual(M);
    expect(out.x + TW).toBeLessThanOrEqual(W - M);
    expect(out.y + TH).toBeLessThanOrEqual(H - M);
  });
});

describe('tooltip lifecycle', () => {
  const seen = (s: { n: number }) => () => { s.n++; };

  it('starts with the first arrow, shows for 2.5 s and saves the flag only once shown', () => {
    const s = createTipState(false);
    const saved = { n: 0 };
    expect(stepTip(s, -1, () => false, 0.1, seen(saved))).toBe(false); // no arrow yet
    expect(stepTip(s, 4, (id) => id === 4, 0.1, seen(saved))).toBe(true);
    expect(saved.n).toBe(1);
    let t = 0.1;
    while (t < THREAT_TIP_S - 0.05) { expect(stepTip(s, 4, () => true, 0.1, seen(saved))).toBe(true); t += 0.1; }
    for (let i = 0; i < 5; i++) stepTip(s, 4, () => true, 0.1, seen(saved));
    expect(stepTip(s, 4, () => true, 0.1, seen(saved))).toBe(false); // done
    expect(saved.n).toBe(1);
    expect(THREAT_TIP_S).toBe(2.5);
  });

  it('hides while its arrow is gone and tries again if it was never shown', () => {
    const s = createTipState(false);
    const saved = { n: 0 };
    // The first arrow appears for a frame, but its tip never gets drawn (arrow gone at once).
    expect(stepTip(s, 2, () => false, 0.1, seen(saved))).toBe(false);
    for (let i = 0; i < 30; i++) stepTip(s, -1, () => false, 0.1, seen(saved));
    expect(saved.n).toBe(0);
    // A later arrow gets the tooltip.
    expect(stepTip(s, 5, (id) => id === 5, 0.1, seen(saved))).toBe(true);
    expect(saved.n).toBe(1);
  });

  it('never shows once seen', () => {
    const s = createTipState(true);
    const saved = { n: 0 };
    expect(stepTip(s, 1, () => true, 0.1, seen(saved))).toBe(false);
    expect(saved.n).toBe(0);
  });
});

describe('joystick knob', () => {
  it('follows the drag inside the ring', () => {
    const o = knobOffset({ x: 100, y: 100 }, { x: 110, y: 90 }, { x: 0, y: 0 });
    expect(o).toEqual({ x: 10, y: -10 });
  });
  it('is clamped to KNOB_MAX_PX (38 px) along the drag', () => {
    expect(KNOB_MAX_PX).toBe(38);
    const o = knobOffset({ x: 0, y: 0 }, { x: 60, y: 80 }, { x: 0, y: 0 });
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(38);
    expect(o.x / o.y).toBeCloseTo(60 / 80);
  });
  it('reuses out', () => {
    const out = { x: 0, y: 0 };
    expect(knobOffset({ x: 0, y: 0 }, { x: 1, y: 1 }, out)).toBe(out);
  });
});

describe('joyFade', () => {
  it('fades in over 120 ms and out over 180 ms', () => {
    expect(joyFade(0, true, 0.06, false)).toBeCloseTo(0.5);
    expect(joyFade(0, true, 0.12, false)).toBe(1);
    expect(joyFade(1, false, 0.09, false)).toBeCloseTo(0.5);
    expect(joyFade(1, false, 0.18, false)).toBe(0);
    expect(joyFade(1, true, 1, false)).toBe(1);
    expect(joyFade(0, false, 1, false)).toBe(0);
  });
  it('snaps under reduced motion', () => {
    expect(joyFade(0, true, 0.001, true)).toBe(1);
    expect(joyFade(1, false, 0.001, true)).toBe(0);
  });
});

describe('first-time steer tip', () => {
  it('text depends on touch vs desktop', () => {
    expect(steerTipText(true)).toBe('Drag anywhere to steer');
    expect(steerTipText(false)).toBe('Use arrow keys or drag to steer');
  });
  it('never shows once seen', () => {
    const s = createSteerTipState(true);
    let calls = 0;
    expect(stepSteerTip(s, false, 0.016, () => calls++)).toBe(0);
    expect(calls).toBe(0);
  });
  it('shows for STEER_TIP_S (3 s), saving the seen flag once', () => {
    expect(STEER_TIP_S).toBe(3);
    const s = createSteerTipState(false);
    let calls = 0;
    let a = stepSteerTip(s, false, 0.016, () => calls++);
    expect(a).toBeGreaterThan(0);
    let t = 0.016;
    while (t < 2.5) { a = stepSteerTip(s, false, 0.1, () => calls++); t += 0.1; }
    expect(a).toBe(1);
    for (let i = 0; i < 10; i++) a = stepSteerTip(s, false, 0.1, () => calls++);
    expect(a).toBe(0);
    expect(calls).toBe(1);
  });
  it('fades away soon after the first steer', () => {
    const s = createSteerTipState(false);
    stepSteerTip(s, false, 0.5, () => {});
    let a = stepSteerTip(s, true, 0.016, () => {});
    expect(a).toBeLessThan(1);
    for (let i = 0; i < 5; i++) a = stepSteerTip(s, false, 0.1, () => {});
    expect(a).toBe(0);
  });
  it('the seen flag survives blocked storage', () => {
    expect(steerTipSeen({ getItem: () => { throw new Error('blocked'); }, setItem() {} })).toBe(false);
    expect(steerTipSeen({ getItem: (k) => (k === STEER_TIP_KEY ? '1' : null), setItem() {} })).toBe(true);
  });
});
