import { createSession, type Session } from './game/session';
import { unlockAudio } from './game/sound';
import { PALETTE } from './game/palette';
import { DIFFICULTIES, type Difficulty } from './sim/config';
import { loadBest, recordRun } from './ui/best';
import { cleanName, createScreens, DEFAULT_NAME, type StartPrefs } from './ui/screens';

const HUD_INTERVAL_MS = 100;
const NAME_KEY = 'territory-wars.name';
const COLOR_KEY = 'territory-wars.color';
const DIFFICULTY_KEY = 'territory-wars.difficulty';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = createScreens(document.getElementById('ui') as HTMLElement);

function loadPrefs(): StartPrefs {
  let name = DEFAULT_NAME;
  let color = 0;
  let difficulty: Difficulty = 'normal';
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) name = cleanName(n);
    const c = Number(localStorage.getItem(COLOR_KEY));
    if (Number.isInteger(c) && c >= 0 && c < PALETTE.players.length) color = c;
    const d = localStorage.getItem(DIFFICULTY_KEY) as Difficulty | null;
    if (d && DIFFICULTIES.includes(d)) difficulty = d;
  } catch { /* storage unavailable */ }
  return { name, color, difficulty };
}

function savePrefs(p: StartPrefs): void {
  try {
    localStorage.setItem(NAME_KEY, p.name);
    localStorage.setItem(COLOR_KEY, String(p.color));
    localStorage.setItem(DIFFICULTY_KEY, p.difficulty);
  } catch { /* storage unavailable */ }
}

// start → playing → over → start. Each game gets a fresh, one-shot session;
// the previous one stays painted behind the start screen until replaced.
let session: Session | null = null;
let hudTimer: ReturnType<typeof setInterval> | null = null;
let hudFrame: number | null = null;

function stopHud(): void {
  if (hudTimer !== null) clearInterval(hudTimer);
  hudTimer = null;
  if (hudFrame !== null) cancelAnimationFrame(hudFrame);
  hudFrame = null;
}

/** Runs the % count-up per animation frame, only while it is animating. */
function animateHud(): void {
  if (hudFrame !== null) return;
  const frame = (now: number) => {
    hudFrame = ui.tickHud(now) ? requestAnimationFrame(frame) : null;
  };
  hudFrame = requestAnimationFrame(frame);
}

function refreshHud(world: Session['world']): void {
  if (ui.updateHud(world, performance.now())) animateHud();
}

function toStart(): void {
  ui.showStart(loadPrefs(), loadBest, (prefs) => {
    unlockAudio(); // inside the click gesture
    savePrefs(prefs);
    play(prefs);
  });
}

function play(prefs: StartPrefs): void {
  stopHud();
  session?.dispose();
  ui.showHud(); // before the session so the minimap has its CSS size
  const s = createSession(canvas, {
    minimap: ui.minimap,
    humanName: prefs.name,
    humanColor: prefs.color,
    difficulty: prefs.difficulty,
    onDown: (world, killerName) => {
      const human = world.players[world.humanId];
      ui.showRevive({
        killerName,
        cause: world.downCause ?? 'self',
        best: loadBest(prefs.difficulty), // recorded only at the end, so this is the pre-run best
        difficulty: prefs.difficulty,
        kills: human.kills,
        time: world.time,
      }, {
        revive: () => s.revive(),
        giveUp: () => s.giveUp(),
      });
    },
    onOver: (world) => {
      ui.hideRevive();
      stopHud();
      const human = world.players[world.humanId];
      const run = { pct: s.finalPct(), kills: human.kills, time: world.time };
      const newBest = recordRun(run, prefs.difficulty);
      ui.showOver({ ...run, won: world.won, newBest, difficulty: prefs.difficulty }, () => {
        unlockAudio();
        play(prefs);
      }, toStart);
    },
  });
  session = s;
  refreshHud(s.world);
  // Frozen once over (or knocked out), so the death-shrink tail doesn't read as 0%.
  hudTimer = setInterval(() => {
    if (!s.world.over && !s.world.awaitingRevive) refreshHud(s.world);
  }, HUD_INTERVAL_MS);
  s.start();
}

toStart();
