import { CONFIG } from '../sim/config';
import { createBrains, botInputs } from '../sim/bots';
import { mulberry32 } from '../sim/rng';
import { landArea } from '../sim/territory';
import { createWorld, pct, step, type World } from '../sim/world';
import { createCamera, type Camera } from './camera';
import { createInput } from './input';
import { createEffects, type Effects } from './effects';
import { createLoop } from './loop';
import { drawMinimap } from './minimap';
import { createFx, interpPos, render, snapshotFx, type Fx } from './render';

export type SessionOpts = {
  seed?: number;
  humanName?: string;
  humanColor?: number;
  /**
   * Called once, OVER_TAIL_MS after world.over becomes true (effects such as
   * the human's death shrink finish first). The loop is stopped and input
   * disposed by then; the last frame stays on the canvas.
   */
  onOver?: (world: World) => void;
  /** Optional overview canvas (sized by CSS); redrawn every frame. */
  minimap?: HTMLCanvasElement;
};

export type Session = {
  world: World;
  camera: Camera;
  fx: Fx;
  effects: Effects;
  /** Human's % at the moment the game ended (land at death, before the shrink). */
  finalPct(): number;
  start(): void;
  /** Stops the loop (the last frame stays painted and repaints on resize). */
  stop(): void;
  /** Stops everything and removes every listener. Sessions are one-shot. */
  dispose(): void;
};

/** How long the game keeps rendering after it ends, before onOver. */
export const OVER_TAIL_MS = 1200;
const MAX_DPR = 2;

/** Wires world + bots + input + loop + camera + renderer + effects onto a canvas. */
export function createSession(canvas: HTMLCanvasElement, opts: SessionOpts = {}): Session {
  const seed = (opts.seed ?? Date.now()) >>> 0;
  const world = createWorld({
    seed,
    humanName: opts.humanName ?? 'You',
    humanColor: opts.humanColor ?? 0,
  });
  const brains = createBrains(world);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const ctx = canvas.getContext('2d')!;
  const mini = opts.minimap ?? null;
  const miniCtx = mini?.getContext('2d') ?? null;
  let miniSize = 0;
  const camera = createCamera();
  const fx = createFx();
  const effects = createEffects();
  const input = createInput(canvas);
  let inputDisposed = false;
  const disposeInput = () => {
    if (inputDisposed) return;
    inputDisposed = true;
    input.dispose();
  };

  let dpr = 1;
  let running = false;
  let lastAlpha = 1;

  const paint = (alpha: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, world, camera, alpha, fx, effects);
    if (miniCtx && miniSize > 0) drawMinimap(miniCtx, world, miniSize, dpr, alpha, camera);
  };

  const resize = () => {
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.resize(w, h);
    if (mini) {
      miniSize = mini.getBoundingClientRect().width;
      mini.width = Math.round(miniSize * dpr);
      mini.height = Math.round(miniSize * dpr);
    }
    // Resizing clears the canvas; repaint so it never goes blank while stopped.
    if (!running) paint(lastAlpha);
  };
  // Camera must be placed before the first paint.
  camera.update(world.players[world.humanId].pos, pct(world, world.humanId), 0);
  resize();
  window.addEventListener('resize', resize);

  let lastFrame: number | null = null;
  let overAt: number | null = null;
  let overNotified = false;
  let finalPct = 0;

  const stepFn = () => {
    if (world.over) return;
    snapshotFx(fx, world);
    const inputs = botInputs(world, brains, rng);
    inputs.set(world.humanId, { targetHeading: input.targetHeading() });
    step(world, inputs);
    // world.events only holds this step's events; hand them over every step.
    if (world.events.length) effects.onEvents(world.events, world, camera);
    if (world.over) {
      const h = world.players[world.humanId];
      const land = h.alive ? h.land : h.dyingLand ?? [];
      finalPct = (landArea(land) / (Math.PI * CONFIG.ARENA_R * CONFIG.ARENA_R)) * 100;
    }
  };

  const renderFn = (alpha: number) => {
    const now = performance.now();
    const dt = lastFrame === null ? CONFIG.DT : Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    // Once over, nothing steps: pin interpolation so survivors don't wobble.
    const a = world.over ? 1 : alpha;
    lastAlpha = a;
    effects.update(dt);
    const human = world.players[world.humanId];
    camera.update(interpPos(human, a), pct(world, world.humanId), dt);
    paint(a);

    if (world.over && !overNotified) {
      if (overAt === null) {
        overAt = now;
        disposeInput();
      }
      if (now - overAt >= OVER_TAIL_MS) {
        overNotified = true;
        stop();
        opts.onOver?.(world);
      }
    }
  };

  const loop = createLoop(stepFn, renderFn, CONFIG.DT);

  function stop() {
    running = false;
    loop.stop();
  }

  let disposed = false;
  return {
    world,
    camera,
    fx,
    effects,
    finalPct: () => finalPct,
    start() {
      if (disposed || running || overNotified) return;
      running = true;
      lastFrame = null;
      loop.start();
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      window.removeEventListener('resize', resize);
      disposeInput();
    },
  };
}
