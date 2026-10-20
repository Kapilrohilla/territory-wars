import { CONFIG } from '../sim/config';
import { createBrains, botInputs } from '../sim/bots';
import { mulberry32 } from '../sim/rng';
import { createWorld, pct, step, type World } from '../sim/world';
import { createCamera, type Camera } from './camera';
import { createInput } from './input';
import { createLoop } from './loop';
import { createFx, interpPos, render, snapshotFx, type Fx } from './render';

export type SessionOpts = {
  seed?: number;
  humanName?: string;
  humanColor?: number;
  /** Called once, on the step where world.over becomes true. */
  onOver?: (world: World) => void;
};

export type Session = {
  world: World;
  camera: Camera;
  fx: Fx;
  start(): void;
  stop(): void;
};

/** Wires world + bots + input + loop + camera + renderer onto a canvas. */
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
  const camera = createCamera();
  const fx = createFx();
  const input = createInput(canvas);

  let dpr = 1;
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.resize(w, h);
  };
  resize();

  let lastFrame: number | null = null;
  let overNotified = false;

  const stepFn = () => {
    if (world.over) return;
    snapshotFx(fx, world);
    const inputs = botInputs(world, brains, rng);
    inputs.set(world.humanId, { targetHeading: input.targetHeading() });
    step(world, inputs);
    if (world.over && !overNotified) {
      overNotified = true;
      loop.stop();
      opts.onOver?.(world);
    }
  };

  const renderFn = (alpha: number) => {
    const now = performance.now();
    const dt = lastFrame === null ? CONFIG.DT : Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const human = world.players[world.humanId];
    camera.update(interpPos(human, alpha), pct(world, world.humanId), dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, world, camera, alpha, fx);
  };

  const loop = createLoop(stepFn, renderFn, CONFIG.DT);

  return {
    world,
    camera,
    fx,
    start() {
      window.addEventListener('resize', resize);
      lastFrame = null;
      loop.start();
    },
    stop() {
      loop.stop();
      window.removeEventListener('resize', resize);
      input.dispose();
    },
  };
}
