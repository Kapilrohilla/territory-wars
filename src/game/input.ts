export type InputSource = { targetHeading(): number | null; dispose(): void };

const DEAD_ZONE_PX = 8;
/** Floating joystick: the anchor trails the pointer so reversing is instant. */
const MAX_RADIUS_PX = 60;

const KEY_RELEASE_GRACE_MS = 60;

const KEYS: Record<string, 'l' | 'r' | 'u' | 'd'> = {
  ArrowLeft: 'l', KeyA: 'l',
  ArrowRight: 'r', KeyD: 'r',
  ArrowUp: 'u', KeyW: 'u',
  ArrowDown: 'd', KeyS: 'd',
};

/**
 * Pointer floating joystick + arrows/WASD (8 directions).
 * World convention: heading 0 = +x, +y is down on screen.
 */
export function createInput(el: HTMLElement): InputSource {
  let heading: number | null = null;
  let pointerId: number | null = null;
  let ox = 0, oy = 0;
  const held = { l: false, r: false, u: false, d: false };
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;

  const onDown = (e: PointerEvent) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    e.preventDefault();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > DEAD_ZONE_PX) heading = Math.atan2(dy, dx);
    if (d > MAX_RADIUS_PX) {
      ox = e.clientX - (dx / d) * MAX_RADIUS_PX;
      oy = e.clientY - (dy / d) * MAX_RADIUS_PX;
    }
    e.preventDefault();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null; // releasing keeps the last heading
  };

  const applyKeys = () => {
    const x = (held.r ? 1 : 0) - (held.l ? 1 : 0);
    const y = (held.d ? 1 : 0) - (held.u ? 1 : 0);
    if (x !== 0 || y !== 0) heading = Math.atan2(y, x);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const k = KEYS[e.code];
    if (!k) return;
    held[k] = true;
    if (releaseTimer !== null) { clearTimeout(releaseTimer); releaseTimer = null; }
    applyKeys();
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const k = KEYS[e.code];
    if (!k) return;
    held[k] = false;
    // Remaining keys keep steering (diagonal → straight), after a short grace
    // so releasing both diagonal keys a few ms apart doesn't snap to one axis.
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => { releaseTimer = null; applyKeys(); }, KEY_RELEASE_GRACE_MS);
  };
  const onBlur = () => { held.l = held.r = held.u = held.d = false; };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    targetHeading: () => heading,
    dispose() {
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
