import { CONFIG, type Difficulty } from '../sim/config';
import { createBrains, botInputs } from '../sim/bots';
import { mulberry32 } from '../sim/rng';
import { landArea } from '../sim/territory';
import { createWorld, declineRevive, pct, reviveHuman, step, type World } from '../sim/world';
import { createCamera, type Camera } from './camera';
import { createInput } from './input';
import { createEffects, type Effects } from './effects';
import { createLoop } from './loop';
import { drawMinimap } from './minimap';
import { soundsFor } from './sfxEvents';
import { playSound } from './sound';
import { createFx, interpPos, render, snapshotFx, type Fx } from './render';

export type SessionOpts = {
  seed?: number;
  humanName?: string;
  humanColor?: number;
  difficulty?: Difficulty;
  /**
   * Called once, OVER_TAIL_MS after world.over becomes true (effects such as
   * the human's death shrink finish first). The loop is stopped and input
   * disposed by then; the last frame stays on the canvas.
   */
  onOver?: (world: World) => void;
  /** Optional overview canvas (sized by CSS); redrawn every frame. */
  minimap?: HTMLCanvasElement;
  /**
   * Called once, DOWN_DELAY_MS after the human is knocked out with a revive left (so the
   * hit is seen first). The world is frozen until revive() or giveUp().
   */
  onDown?: (world: World, killerName: string | null) => void;
  /** Asked before each revive; it only happens on true. The hook for a future rewarded ad. */
  requestRevive?: () => Promise<boolean>;
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
  /**
   * Revives the knocked-out human (once per round) if requestRevive agrees, and resumes.
   * Resolves true when revived.
   */
  revive(): Promise<boolean>;
  /** Declines the revive: the game ends and onOver follows after the usual tail. */
  giveUp(): void;
};

/** How long the game keeps rendering after it ends, before onOver. */
export const OVER_TAIL_MS = 1200;
/** Delay between the knock-out and onDown, so the hit is visible first. */
export const DOWN_DELAY_MS = 600;
const MAX_DPR = 2;

/** Wires world + bots + input + loop + camera + renderer + effects onto a canvas. */
export function createSession(canvas: HTMLCanvasElement, opts: SessionOpts = {}): Session {
  const seed = (opts.seed ?? Date.now()) >>> 0;
  const world = createWorld({
    seed,
    humanName: opts.humanName ?? 'You',
    humanColor: opts.humanColor ?? 0,
    difficulty: opts.difficulty ?? 'normal',
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
    // Resizing clears the canvas; repaint so it never goes blank while stopped or frozen.
    if (!running || world.awaitingRevive) paint(lastAlpha);
  };
  // Camera must be placed before the first paint.
  camera.update(world.players[world.humanId].pos, pct(world, world.humanId), 0);
  resize();
  window.addEventListener('resize', resize);

  let lastFrame: number | null = null;
  let overAt: number | null = null;
  let overNotified = false;
  let finalPct = 0;

  const notifyEvents = () => {
    // world.events only holds the latest step's (or revive call's) events.
    if (world.events.length) {
      effects.onEvents(world.events, world, camera);
      for (const name of soundsFor(world.events, world)) playSound(name);
    }
  };
  const recordFinalPct = () => {
    const h = world.players[world.humanId];
    const land = h.alive ? h.land : h.dyingLand ?? [];
    finalPct = (landArea(land) / (Math.PI * CONFIG.ARENA_R * CONFIG.ARENA_R)) * 100;
  };

  // Knocked out: the world is frozen behind the revive offer; rendering goes on.
  let downAt: number | null = null;
  let downNotified = false;
  let reviveRequested = false;
  /** The settled frozen frame has been painted; later frames skip painting until unfrozen. */
  let frozenPainted = false;

  const stepFn = () => {
    if (world.over || world.awaitingRevive) return;
    snapshotFx(fx, world);
    const inputs = botInputs(world, brains, rng);
    inputs.set(world.humanId, { targetHeading: input.targetHeading() });
    step(world, inputs);
    notifyEvents();
    if (world.over) recordFinalPct();
  };

  const renderFn = (alpha: number) => {
    const now = performance.now();
    const dt = lastFrame === null ? CONFIG.DT : Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    // Once over (or frozen), nothing steps: pin interpolation so survivors don't wobble.
    const a = world.over || world.awaitingRevive ? 1 : alpha;
    lastAlpha = a;
    effects.update(dt);
    // Frozen behind the revive modal with no effect left to play: the frame is static under
    // the blurred overlay, so skip repainting it (resize still repaints). Painting resumes
    // after revive()/giveUp(), which clear awaitingRevive.
    const idleFrozen = world.awaitingRevive && !effects.busy();
    if (!idleFrozen || !frozenPainted) {
      const human = world.players[world.humanId];
      camera.update(interpPos(human, a), pct(world, world.humanId), dt);
      paint(a);
    }
    frozenPainted = idleFrozen; // one paint after the effects settle, then none

    if (world.awaitingRevive && !downNotified) {
      if (downAt === null) downAt = now;
      if (now - downAt >= DOWN_DELAY_MS) {
        downNotified = true;
        const k = world.downKillerId;
        opts.onDown?.(world, k === null ? null : world.players[k].name);
      }
    }

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
    async revive() {
      if (disposed || reviveRequested || !world.awaitingRevive) return false;
      reviveRequested = true; // one revive per round, even across double clicks
      let ok = false;
      try { ok = await (opts.requestRevive ?? (async () => true))(); } catch { ok = false; }
      if (!ok || disposed || !world.awaitingRevive) {
        reviveRequested = !world.awaitingRevive; // a declined request may be asked again
        return false;
      }
      reviveHuman(world);
      playSound('revive');
      snapshotFx(fx, world);
      lastFrame = null;
      return true;
    },
    giveUp() {
      if (disposed || !world.awaitingRevive) return;
      declineRevive(world);
      notifyEvents(); // the final death: the land shrinks during the over-tail
      recordFinalPct();
    },
  };
}
