import { afterEach, describe, expect, it } from 'vitest';
import {
  THREAT_TIP_S, createOverlay, createTipState, placeArrow, placeTip, stepTip, tipSeen, type Rect,
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
