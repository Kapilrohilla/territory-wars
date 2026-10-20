import { describe, it, expect } from 'vitest';
import { steerKey } from '../src/game/input';

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
