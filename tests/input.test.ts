import { describe, it, expect } from 'vitest';
import { createInput, steerKey } from '../src/game/input';

describe('steerKey', () => {
  it('maps arrows and WASD', () => {
    expect(steerKey({ code: 'ArrowLeft' })).toBe('l');
    expect(steerKey({ code: 'KeyD' })).toBe('r');
    expect(steerKey({ code: 'KeyW' })).toBe('u');
    expect(steerKey({ code: 'ArrowDown' })).toBe('d');
  });
  it('ignores unmapped keys and shortcuts', () => {
    expect(steerKey({ code: 'Space' })).toBeNull();
    expect(steerKey({ code: 'KeyW', ctrlKey: true })).toBeNull();
    expect(steerKey({ code: 'KeyA', metaKey: true })).toBeNull();
    expect(steerKey({ code: 'ArrowLeft', altKey: true })).toBeNull();
  });
  it('ignores typing in fields', () => {
    expect(steerKey({ code: 'KeyA', target: { tagName: 'INPUT' } })).toBeNull();
    expect(steerKey({ code: 'KeyA', target: { tagName: 'textarea' } })).toBeNull();
    expect(steerKey({ code: 'KeyA', target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
    expect(steerKey({ code: 'KeyA', target: { tagName: 'CANVAS' } })).toBe('l');
  });
});

describe('pointer()', () => {
  const g = globalThis as { window?: unknown };
  const hadWindow = 'window' in g;
  const prevWindow = g.window;
  const setup = () => {
    g.window = new EventTarget();
    const el = Object.assign(new EventTarget(), { setPointerCapture() {} }) as unknown as HTMLElement;
    return { el, input: createInput(el) };
  };
  const teardown = () => {
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
  };
  const ev = (type: string, pointerId: number, clientX: number, clientY: number, pointerType = 'touch') =>
    Object.assign(new Event(type, { cancelable: true }), { pointerId, clientX, clientY, pointerType });

  it('is null without a drag', () => {
    const { input } = setup();
    try {
      expect(input.pointer()).toBeNull();
    } finally { input.dispose(); teardown(); }
  });
  it('reports the anchor and current point while dragging, in a reused object', () => {
    const { el, input } = setup();
    try {
      el.dispatchEvent(ev('pointerdown', 1, 100, 200));
      const a = input.pointer();
      expect(a).not.toBeNull();
      expect(a!.anchor).toEqual({ x: 100, y: 200 });
      expect(a!.current).toEqual({ x: 100, y: 200 });
      expect(a!.active).toBe(false); // inside the dead zone: not steering yet
      expect(a!.touch).toBe(true);
      el.dispatchEvent(ev('pointermove', 1, 130, 200));
      const b = input.pointer();
      expect(b).toBe(a);
      expect(b!.current).toEqual({ x: 130, y: 200 });
      expect(b!.active).toBe(true);
      el.dispatchEvent(ev('pointerup', 1, 130, 200));
      expect(input.pointer()).toBeNull();
    } finally { input.dispose(); teardown(); }
  });
  it('ignores other pointers and reports the trailing anchor', () => {
    const { el, input } = setup();
    try {
      el.dispatchEvent(ev('pointerdown', 1, 0, 0, 'mouse'));
      el.dispatchEvent(ev('pointermove', 2, 500, 500));
      expect(input.pointer()!.current).toEqual({ x: 0, y: 0 });
      expect(input.pointer()!.touch).toBe(false);
      el.dispatchEvent(ev('pointermove', 1, 100, 0)); // past MAX_RADIUS: the anchor trails
      expect(input.pointer()!.anchor.x).toBeCloseTo(40);
    } finally { input.dispose(); teardown(); }
  });
});
