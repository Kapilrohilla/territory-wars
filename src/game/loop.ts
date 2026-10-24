const MAX_ACCUM = 0.25;
/** A held accumulator stays just under one step. */
const HOLD = 1 - 1e-6;

export type Loop = { tick(nowMs: number): void; start(): void; stop(): void };

/**
 * Fixed-timestep loop. `tick` does the accumulator work and is driven by
 * requestAnimationFrame after `start()`; tests drive it with a fake clock.
 * The first tick only records the time.
 */
export function createLoop(
  stepFn: () => void,
  renderFn: (alpha: number) => void,
  dt: number,
  /**
   * Optional freeze gate (a hit-stop): while it returns false no step runs and the frame time
   * is dropped, so nothing is caught up afterwards; the accumulator is held below one step so
   * the render alpha doesn't jump when the freeze starts or ends.
   */
  canStep?: (nowMs: number) => boolean,
): Loop {
  let last: number | null = null;
  let acc = 0;
  let raf: number | null = null;
  let running = false;

  function tick(nowMs: number): void {
    if (last === null) { last = nowMs; return; }
    const frame = Math.max(0, (nowMs - last) / 1000);
    last = nowMs;
    if (canStep && !canStep(nowMs)) {
      acc = Math.min(acc, dt * HOLD);
    } else {
      acc = Math.min(acc + frame, MAX_ACCUM);
      while (acc >= dt) {
        stepFn();
        acc -= dt;
        // A step may start a freeze (a knockout): the rest of this frame's steps are dropped.
        if (canStep && !canStep(nowMs)) {
          acc = Math.min(acc, dt * HOLD);
          break;
        }
      }
    }
    renderFn(Math.min(Math.max(acc / dt, 0), 1 - 1e-9));
  }

  function frame(now: number): void {
    if (!running) return;
    tick(now);
    if (running) raf = requestAnimationFrame(frame);
  }

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      last = null;
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    },
  };
}
