import { CONFIG, type Difficulty, type SelfCross } from '../sim/config';
import { createBrains, botInputs } from '../sim/bots';
import { mulberry32 } from '../sim/rng';
import { landArea } from '../sim/territory';
import { createWorld, declineRevive, pct, reviveHuman, step, type World } from '../sim/world';
import { createCamera, type Camera } from './camera';
import { createInput } from './input';
import { createEffects, type Effects } from './effects';
import { createLoop } from './loop';
import { drawMinimap } from './minimap';
import { createSfxState, soundsFor, type Cue } from './sfxEvents';
import { currentListener, playSound, setListener } from './sound';
import { createFx, interpPos, prefersReducedMotion, render, snapshotFx, type Fx } from './render';
import { createMoodState, moodEvents, moodOf } from './moods';
import { botSkin, faceFor, skinById } from './skins';
import { createDangerState, sampleDanger, type DangerState } from './danger';
import { createOverlay, type Rect } from './overlay';
import { createTension } from './tension';
import { createThreatAlert, findThreats, tickThreatAlert, type Threat } from './threats';
import { createHitStop, DOWN_DELAY_MS, downTimeScale, HITSTOP_SCALE, impactEnabled } from './impact';

export type SessionOpts = {
  seed?: number;
  humanName?: string;
  humanColor?: number;
  /** The human's skin id (see skins.ts); it sets the colour too, overriding humanColor. */
  humanSkin?: string;
  difficulty?: Difficulty;
  /** The human's own-trail rule; 'die' when unset. */
  selfCross?: SelfCross;
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
  /**
   * Screen rects (CSS px) of the HUD cards that threat arrows and their tooltip keep clear
   * of. Read on resize and about once a second (the leaderboard grows), never per frame.
   */
  hudRects?: () => readonly Rect[];
  /**
   * Every sound cue as it plays (even when muted), for HUD reactions that follow the same
   * moments: a human 'capture' bumps the % card, a 'milestone' shows the ribbon, a 'kill'
   * (with its quick-kill `streak`) shows the KNOCKOUT! banner.
   */
  onCue?: (cue: Cue) => void;
};

/** How often (ms) the HUD rects are re-read while the round runs. */
const HUD_RECTS_MS = 1000;

export type Session = {
  world: World;
  camera: Camera;
  fx: Fx;
  effects: Effects;
  /**
   * This frame's danger sample (level is 0 with danger warnings off), shared by the overlay,
   * the tension sounds and the HUD so they always agree.
   */
  readonly danger: DangerState;
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
  /** Freezes a running round (not while knocked out or over). Returns true if it paused. */
  pause(): boolean;
  /** Resumes after pause(). */
  resume(): void;
  readonly paused: boolean;
};

/** How long the game keeps rendering after it ends, before onOver. */
export const OVER_TAIL_MS = 1200;
/** Delay between the knock-out and onDown, so the hit is visible first. */
export { DOWN_DELAY_MS };
/** Zoom punch on a knockout by the human: 12% in, springing back (camera.punch). */
const KO_PUNCH = 0.12;
const MAX_DPR = 2;

/** Wires world + bots + input + loop + camera + renderer + effects onto a canvas. */
/**
 * The human's final share of the arena (%): its land while alive, its dying land once dead.
 * A living killer absorbs the land and clears dyingLand, so then the share it had on its
 * last living step (alivePct) counts instead of 0.
 */
export function finalSharePct(world: World, alivePct: number): number {
  const h = world.players[world.humanId];
  const land = h.alive ? h.land : h.dyingLand;
  return land ? (landArea(land) / (Math.PI * CONFIG.ARENA_R * CONFIG.ARENA_R)) * 100 : alivePct;
}

export function createSession(canvas: HTMLCanvasElement, opts: SessionOpts = {}): Session {
  const seed = (opts.seed ?? Date.now()) >>> 0;
  const world = createWorld({
    seed,
    humanName: opts.humanName ?? 'You',
    humanColor: opts.humanSkin !== undefined ? skinById(opts.humanSkin).color : opts.humanColor ?? 0,
    difficulty: opts.difficulty ?? 'normal',
    selfCross: opts.selfCross ?? 'die',
  });
  const brains = createBrains(world);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const ctx = canvas.getContext('2d')!;
  const mini = opts.minimap ?? null;
  const miniCtx = mini?.getContext('2d') ?? null;
  let miniSize = 0;
  const camera = createCamera();
  const fx = createFx();
  const moods = createMoodState();
  const humanSkin = skinById(opts.humanSkin);
  const skins = world.players.map((p) => (p.isHuman ? humanSkin : botSkin(p.id, p.colorIndex, seed)));
  fx.faceOf = (p) => faceFor(skins[p.id] ?? humanSkin, moodOf(p, world, moods));
  const effects = createEffects();
  // Danger is sampled once per frame and shared by the overlay and the tension sounds.
  const danger = createDangerState();
  // Rivals closing on the human's trail, also once per frame (empty with warnings off).
  const threats: Threat[] = [];
  fx.threats = threats;
  const threatAlert = createThreatAlert();
  const input = createInput(canvas);
  const overlay = createOverlay(danger, threats, (p) => fx.faceOf!(p), input);
  const tension = createTension();
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
    overlay.draw(ctx, camera);
    if (miniCtx && miniSize > 0) drawMinimap(miniCtx, world, miniSize, dpr, alpha, camera, threats);
  };

  let hudRectsAt = -Infinity;
  const refreshHudRects = () => {
    if (!opts.hudRects) return;
    hudRectsAt = performance.now();
    overlay.setAvoid(opts.hudRects());
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
    refreshHudRects();
    // Resizing clears the canvas; repaint so it never goes blank while stopped or frozen.
    if (!running || world.awaitingRevive) paint(lastAlpha);
  };
  // Camera must be placed before the first paint.
  camera.update(world.players[world.humanId].pos, pct(world, world.humanId), 0);
  resize();
  // Directional sound: positioned cues are heard from this camera and the human's head.
  setListener(camera, () => world.players[world.humanId].pos);
  window.addEventListener('resize', resize);

  let lastFrame: number | null = null;
  let overAt: number | null = null;
  let overNotified = false;
  let finalPct = 0;

  // Knockout hit-stop and zoom punch; they and the capture/kill nudges respect the
  // "screen shake & freeze-frames" setting and reduce motion (read per event, not per frame).
  const hitStop = createHitStop();
  const impactOn = () => impactEnabled() && !prefersReducedMotion();
  const effectsCam = { nudge: (strength: number) => { if (impactOn()) camera.nudge(strength); } };
  const sfx = createSfxState();
  const notifyEvents = () => {
    // world.events only holds the latest step's (or revive call's) events.
    if (world.events.length) {
      effects.onEvents(world.events, world, effectsCam);
      for (const e of world.events) {
        if (e.type === 'death' && e.killerId === world.humanId && e.playerId !== world.humanId) {
          if (impactOn()) {
            // Steps stop for HITSTOP_MS (the loop's canStep gate); rendering carries on.
            hitStop.trigger(performance.now());
            camera.punch(KO_PUNCH);
          }
          break;
        }
      }
      moodEvents(world.events, world, moods);
    }
    // Every step, even a silent one: the revive shield's end is a state edge, not an event.
    for (const cue of soundsFor(world.events, world, sfx)) {
      playSound(cue.name, cue);
      tension.heard(cue.name, cue.delay);
      opts.onCue?.(cue);
    }
  };
  /** The human's share on the last step it was alive (see finalSharePct). */
  let alivePct = 0;
  const recordFinalPct = () => { finalPct = finalSharePct(world, alivePct); };

  // Knocked out: the world is frozen behind the revive offer; rendering goes on.
  let downAt: number | null = null;
  let downNotified = false;
  /** The down slow-mo's gate (impact setting and reduce motion), cached when the down starts. */
  let downSlowOn = false;
  let reviveRequested = false;
  /** The settled frozen frame has been painted; later frames skip painting until unfrozen. */
  let frozenPainted = false;

  const stepFn = () => {
    if (world.over || world.awaitingRevive) return;
    snapshotFx(fx, world);
    const inputs = botInputs(world, brains, rng);
    inputs.set(world.humanId, { targetHeading: input.targetHeading() });
    if (world.players[world.humanId].alive) alivePct = pct(world, world.humanId);
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
    if (world.awaitingRevive && downAt === null) {
      downAt = now;
      downSlowOn = impactOn(); // read once on the down edge, not per frame
    }
    // Slow-mo through the down (before the revive offer); effects crawl during a hit-stop.
    const slow = downNotified || downAt === null ? 1 : downTimeScale(now - downAt, downSlowOn);
    const fxScale = hitStop.shouldStep(now) ? slow : Math.min(slow, HITSTOP_SCALE);
    effects.update(dt * fxScale);
    if (now - hudRectsAt >= HUD_RECTS_MS) refreshHudRects();
    sampleDanger(world, danger);
    // Real time, and only while the loop runs: silent when paused (no frames), and the
    // controller itself goes quiet behind the revive offer and once the round is over.
    tension.update(world, dt, danger);
    if (danger.warnings) findThreats(world, threats);
    else threats.length = 0;
    // Heard from the side the rival is coming from (threats[0] is the one it fired for).
    if (tickThreatAlert(threatAlert, threats, dt)) playSound('alert', { at: threats[0].pos });
    // Frozen behind the revive modal with no effect left to play: the frame is static under
    // the blurred overlay, so skip repainting it (resize still repaints). Painting resumes
    // after revive()/giveUp(), which clear awaitingRevive.
    const idleFrozen = world.awaitingRevive && !effects.busy();
    if (!idleFrozen || !frozenPainted) {
      const human = world.players[world.humanId];
      camera.update(interpPos(human, a), pct(world, world.humanId), dt * slow);
      overlay.update(world, camera, dt, a);
      // Real frame time for the head lean; repaints outside the loop (resize) pass none.
      fx.frameDt = dt;
      paint(a);
      fx.frameDt = 0;
    }
    frozenPainted = idleFrozen; // one paint after the effects settle, then none

    if (world.awaitingRevive && !downNotified && downAt !== null) {
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

  const loop = createLoop(stepFn, renderFn, CONFIG.DT, (nowMs) => hitStop.shouldStep(nowMs));

  function stop() {
    running = false;
    loop.stop();
  }

  let disposed = false;
  let paused = false;
  return {
    get paused() { return paused; },
    pause() {
      if (disposed || paused || !running || world.over || world.awaitingRevive) return false;
      paused = true;
      hitStop.clear();
      stop();
      return true;
    },
    resume() {
      if (disposed || !paused) return;
      paused = false;
      hitStop.clear();
      running = true;
      lastFrame = null;
      loop.start();
    },
    world,
    camera,
    fx,
    effects,
    danger,
    finalPct: () => finalPct,
    start() {
      if (disposed || running || overNotified || paused) return;
      running = true;
      lastFrame = null;
      loop.start();
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      hitStop.clear();
      stop();
      tension.dispose();
      if (currentListener() === camera) setListener(null);
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
      notifyEvents(); // no events, but the shield going up plays the power-up
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
