import { createSession, type Session } from './game/session';
import { unlockAudio } from './game/sound';
import { PALETTE } from './game/palette';
import { cleanName, createScreens, DEFAULT_NAME, type StartPrefs } from './ui/screens';

const HUD_INTERVAL_MS = 100;
const NAME_KEY = 'territory-wars.name';
const COLOR_KEY = 'territory-wars.color';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = createScreens(document.getElementById('ui') as HTMLElement);

function loadPrefs(): StartPrefs {
  let name = DEFAULT_NAME;
  let color = 0;
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) name = cleanName(n);
    const c = Number(localStorage.getItem(COLOR_KEY));
    if (Number.isInteger(c) && c >= 0 && c < PALETTE.players.length) color = c;
  } catch { /* storage unavailable */ }
  return { name, color };
}

function savePrefs(p: StartPrefs): void {
  try {
    localStorage.setItem(NAME_KEY, p.name);
    localStorage.setItem(COLOR_KEY, String(p.color));
  } catch { /* storage unavailable */ }
}

// start → playing → over → start. Each game gets a fresh, one-shot session;
// the previous one stays painted behind the start screen until replaced.
let session: Session | null = null;
let hudTimer: ReturnType<typeof setInterval> | null = null;

function stopHud(): void {
  if (hudTimer !== null) clearInterval(hudTimer);
  hudTimer = null;
}

function toStart(): void {
  ui.showStart(loadPrefs(), (prefs) => {
    unlockAudio(); // inside the click gesture
    savePrefs(prefs);
    play(prefs);
  });
}

function play(prefs: StartPrefs): void {
  stopHud();
  session?.dispose();
  const s = createSession(canvas, {
    humanName: prefs.name,
    humanColor: prefs.color,
    onOver: (world) => {
      stopHud();
      const human = world.players[world.humanId];
      ui.showOver({ won: world.won, pct: s.finalPct(), kills: human.kills, time: world.time }, toStart);
    },
  });
  session = s;
  ui.showHud();
  ui.updateHud(s.world);
  // Frozen once over, so the death-shrink tail doesn't read as 0%.
  hudTimer = setInterval(() => { if (!s.world.over) ui.updateHud(s.world); }, HUD_INTERVAL_MS);
  s.start();
}

toStart();
