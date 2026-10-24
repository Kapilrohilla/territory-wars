// Fonts are bundled (not fetched from Google Fonts) so the app starts fast and looks
// right offline. Only the weights style.css uses, Latin + Latin Extended subsets.
import '@fontsource/rubik/latin-700.css';
import '@fontsource/rubik/latin-ext-700.css';
import '@fontsource/rubik/latin-800.css';
import '@fontsource/rubik/latin-ext-800.css';
import '@fontsource/rubik/latin-900.css';
import '@fontsource/rubik/latin-ext-900.css';
import '@fontsource/nunito-sans/latin-400.css';
import '@fontsource/nunito-sans/latin-ext-400.css';
import '@fontsource/nunito-sans/latin-600.css';
import '@fontsource/nunito-sans/latin-ext-600.css';
import '@fontsource/nunito-sans/latin-700.css';
import '@fontsource/nunito-sans/latin-ext-700.css';
import { createSession, type Session } from './game/session';
import { playSound, unlockAudio } from './game/sound';
import { DIFFICULTIES, type Difficulty } from './sim/config';
import { loadBest, recordRun } from './ui/best';
import {
  loadAdUnlocks, loadLifetime, loadSkin, newlyUnlocked, recordRevive, recordRound, saveAdUnlock, saveSkin,
} from './ui/progress';
import { cleanName, createScreens, DEFAULT_NAME, loadSelfCross, type StartPrefs, type Tab } from './ui/screens';
import { attachNativeAd, initAds, privacyOptionsRequired, showPrivacyOptions, showRewarded } from './native/ads';
import { initApp, isNative } from './native/platform';

const HUD_INTERVAL_MS = 100;
const NAME_KEY = 'territory-wars.name';
const DIFFICULTY_KEY = 'territory-wars.difficulty';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = createScreens(document.getElementById('ui') as HTMLElement);

function loadPrefs(): StartPrefs {
  let name = DEFAULT_NAME;
  let difficulty: Difficulty = 'normal';
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n) name = cleanName(n);
    const d = localStorage.getItem(DIFFICULTY_KEY) as Difficulty | null;
    if (d && DIFFICULTIES.includes(d)) difficulty = d;
  } catch { /* storage unavailable */ }
  return { name, difficulty };
}

function savePrefs(p: StartPrefs): void {
  try {
    localStorage.setItem(NAME_KEY, p.name);
    localStorage.setItem(DIFFICULTY_KEY, p.difficulty);
  } catch { /* storage unavailable */ }
}

// start → playing → over → start. Each game gets a fresh, one-shot session;
// the previous one stays painted behind the start screen until replaced.
let session: Session | null = null;
let screen: 'home' | 'skins' | 'records' | 'playing' | 'over' = 'home';
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

function refreshHud(s: Session): void {
  if (ui.updateHud(s.world, performance.now(), s.danger.level)) animateHud();
}

function go(tab: Tab): void {
  if (tab === 'skins') toSkins();
  else if (tab === 'records') toRecords();
  else toStart();
}

function toStart(): void {
  screen = 'home';
  ui.showStart(loadPrefs(), loadSkin(loadLifetime(), loadAdUnlocks()), loadBest, (prefs) => {
    unlockAudio(); // inside the click gesture
    savePrefs(prefs);
    play(prefs);
  }, (tab, prefs) => {
    savePrefs(prefs); // keep the picks for the way back
    go(tab);
  });
}

function toRecords(): void {
  screen = 'records';
  ui.showRecords({
    bestFor: loadBest,
    lifetime: loadLifetime(),
    native: isNative,
    openPrivacy: async () => (await privacyOptionsRequired()) && showPrivacyOptions(),
  }, go);
}

function toSkins(): void {
  screen = 'skins';
  const lifetime = loadLifetime();
  const adUnlocks = loadAdUnlocks();
  ui.showSkins({
    selected: loadSkin(lifetime, adUnlocks).id,
    lifetime,
    adUnlocks,
    native: isNative,
    select: saveSkin,
    unlockWithAd: async (id) => {
      const ok = await showRewarded(); // free in a browser
      if (ok) saveAdUnlock(id);
      return ok;
    },
  }, go);
}

/** Pauses the running round and opens the pause menu (no-op when it can't pause). */
function pauseGame(): void {
  const s = session;
  if (screen !== 'playing' || !s || !s.pause()) return;
  ui.showPause({
    resume: () => s.resume(),
    restart: () => play(lastPrefs!),
    home: () => {
      stopHud();
      s.dispose();
      toStart();
    },
  });
}

let lastPrefs: StartPrefs | null = null;

function play(prefs: StartPrefs): void {
  stopHud();
  session?.dispose();
  screen = 'playing';
  lastPrefs = prefs;
  ui.showHud(pauseGame, () => session?.music.events([{ e: 'overtake' }])); // before the session so the minimap has its CSS size
  const lifetimeBefore = loadLifetime();
  const s = createSession(canvas, {
    minimap: ui.minimap,
    hudRects: () => ui.hudRects(),
    onCue: (cue) => {
      if (cue.name === 'capture') ui.bumpPct();
      else if (cue.name === 'milestone') ui.showMilestone(cue.tier ?? 0, cue.delay);
      else if (cue.name === 'kill') ui.showKnockout(cue.streak ?? 0);
    },
    humanName: prefs.name,
    humanSkin: loadSkin(lifetimeBefore, loadAdUnlocks()).id,
    difficulty: prefs.difficulty,
    selfCross: loadSelfCross(),
    requestRevive: showRewarded, // a rewarded ad in the app; free in a browser
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
        revive: async () => {
          const ok = await s.revive();
          if (ok) recordRevive();
          return ok;
        },
        giveUp: () => s.giveUp(),
      });
    },
    onOver: (world) => {
      ui.hideRevive();
      stopHud();
      screen = 'over';
      const human = world.players[world.humanId];
      const run = { pct: s.finalPct(), kills: human.kills, time: world.time };
      const newBest = recordRun(run, prefs.difficulty);
      if (newBest) setTimeout(() => playSound('newBest'), 450);
      const best = loadBest(prefs.difficulty);
      // Against the start of the round, so a revive that unlocked a skin mid-round counts too.
      const after = recordRound({ kills: run.kills, pct: run.pct, won: world.won });
      const unlocked = newlyUnlocked(lifetimeBefore, after).map((k) => k.name);
      ui.showOver({ ...run, won: world.won, newBest, difficulty: prefs.difficulty, best, unlocked }, () => {
        unlockAudio();
        play(prefs);
      }, toStart, isNative ? attachNativeAd : undefined);
    },
  });
  session = s;
  playSound('start');
  refreshHud(s);
  // Frozen once over (or knocked out), so the death-shrink tail doesn't read as 0%.
  hudTimer = setInterval(() => {
    if (!s.world.over && !s.world.awaitingRevive && !s.paused) refreshHud(s);
  }, HUD_INTERVAL_MS);
  s.start();
}

toStart();

// Leaving the app or tab mid-round opens the pause menu, so nobody comes back to a death.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

void initApp({
  // Back: skins, records or results → home; mid-game it pauses (or resumes); on home it quits.
  onBack: () => {
    if (screen === 'over' || screen === 'records' || screen === 'skins') { toStart(); return true; }
    if (screen === 'playing') {
      if (session?.paused) {
        ui.hidePause();
        session.resume();
      } else {
        pauseGame();
      }
      return true;
    }
    return false;
  },
  onResume: unlockAudio,
});
// Consent form (where required) and SDK start, so the first revive ad loads fast.
void initAds();
