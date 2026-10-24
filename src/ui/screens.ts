import { COLOR_NAMES, PALETTE } from '../game/palette';
import { isMuted, playSelect, playTick, setMuted, unlockAudio } from '../game/sound';
import { isNative, isVibrationOn, setVibrationOn } from '../native/platform';
import { NAMES } from '../sim/names';
import { pct } from '../sim/world';
import { CONFIG, DIFFICULTIES, SELF_CROSS_MODES, type Difficulty, type SelfCross } from '../sim/config';
import type { DeathCause, Player, World } from '../sim/types';
import type { BestScore } from './best';
import { button, el, icon, labelRow, setText, statTile, svg, type IconName } from './dom';
import type { Lifetime } from './progress';
import { createSkinsScreen, paintSkin, type SkinsView } from './skinsScreen';
import type { Skin } from '../game/skins';
import { DANGER_SHOW } from '../game/danger';

// ---------- pure helpers (unit-tested) ----------

export type BoardEntry = { id: number; name: string; colorIndex: number; pct: number; isHuman: boolean };
export type BoardRow = BoardEntry & { rank: number; leader: boolean };

/** Top `n` by % (ties by id), plus the human's row appended if not among them. */
export function buildLeaderboard(entries: BoardEntry[], n = 5): BoardRow[] {
  const sorted = [...entries].sort((a, b) => b.pct - a.pct || a.id - b.id);
  const rows: BoardRow[] = sorted.map((e, i) => ({ ...e, rank: i + 1, leader: i === 0 }));
  const top = rows.slice(0, n);
  if (!top.some((r) => r.isHuman)) {
    const you = rows.find((r) => r.isHuman);
    if (you) top.push(you);
  }
  return top;
}

export function boardEntries(world: World): BoardEntry[] {
  return world.players
    .filter((p) => p.alive || p.isHuman)
    .map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex, pct: pct(world, p.id), isHuman: p.isHuman }));
}

export function formatPct(v: number, decimals: number): string {
  return `${Math.max(0, v).toFixed(decimals)}%`;
}

/** m:ss */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type PctTween = {
  /** Jump straight to v (no animation). */
  snap(v: number): void;
  /** Animate from the currently shown value to `target`, starting at `now` (ms). */
  set(target: number, now: number): void;
  value(now: number): number;
  active(now: number): boolean;
};

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Displayed-number tween: counts towards each new target over `durationMs`, easing out. */
export function createPctTween(durationMs = 300): PctTween {
  let from = 0, to = 0, start = -Infinity;
  const progress = (now: number) => Math.min(1, Math.max(0, (now - start) / durationMs));
  const value = (now: number) => {
    const k = progress(now);
    return k >= 1 ? to : from + (to - from) * easeOutCubic(k);
  };
  return {
    snap(v) { from = to = v; start = -Infinity; },
    set(target, now) {
      if (target === to) return;
      from = value(now);
      to = target;
      start = now;
    },
    value,
    active: (now) => progress(now) < 1,
  };
}

/** Whole seconds left on a countdown, rounded up (5000 ms → 5, 4001 ms → 5, 0 → 0). */
export function countdownSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/** Share of the countdown still left, for the ring, in [0, 1]. */
export function countdownFraction(remainingMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, remainingMs / totalMs));
}

/** Countdown left when it pauses (the tab is hidden) at `now`, never below 0. */
export function pausedRemaining(deadline: number, now: number): number {
  return Math.max(0, deadline - now);
}

/**
 * Revive-modal subtitle, split so the rival's name can be bold: pre + <b>name</b> + post.
 * A null killer means nobody is credited (e.g. the rival who lit the burn has since died).
 */
export function reviveSubtitle(cause: DeathCause, killerName: string | null): { pre: string; name: string; post: string } {
  const plain = (pre: string) => ({ pre, name: '', post: '' });
  if (cause === 'self') return plain('You crossed your own trail');
  if (killerName === null) {
    if (cause === 'trail') return plain('Your trail burned out');
    if (cause === 'captured') return plain('Your land was taken');
    return plain('You were knocked out');
  }
  return { pre: 'Rival ', name: killerName, post: cause === 'trail' ? ' crossed your trail' : ' crashed into you' };
}

export const NAME_MAX = 14;
export const DEFAULT_NAME = 'You';

export function cleanName(raw: string): string {
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return n || DEFAULT_NAME;
}

export type HudAlerts = { burning: boolean; shielded: boolean };

/** HUD warnings for the human: the trail is burning, or the post-revive shield is up. */
export function hudAlerts(p: Pick<Player, 'alive' | 'burn' | 'protectedUntil'>, time: number): HudAlerts {
  return { burning: p.alive && p.burn !== null, shielded: p.alive && time < p.protectedUntil };
}

/** Lit segments (0..3) of the "Far from home" meter: one per full third of danger. */
export function dangerSegments(danger: number): number {
  return Math.max(0, Math.min(3, Math.floor(danger * 3 + 1e-9)));
}

/** Heartbeat icon period (s) at a danger level: 1.0 − 0.55·danger, in 0.05 s steps. */
export function heartbeatSeconds(danger: number): number {
  const d = Math.max(0, Math.min(1, danger));
  return Math.round((1 - 0.55 * d) * 20) / 20;
}

/** The difficulty holding the top best (by isBetter's order); null unless 2+ difficulties have one. */
export function highestBest(bests: Partial<Record<Difficulty, BestScore | null>>): Difficulty | null {
  let top: Difficulty | null = null;
  let count = 0;
  for (const d of DIFFICULTIES) {
    const b = bests[d];
    if (!b) continue;
    count++;
    const t = top ? bests[top]! : null;
    if (!t || b.pct > t.pct || (b.pct === t.pct && b.kills > t.kills)) top = d;
  }
  return count >= 2 ? top : null;
}

type FlagStore = Pick<Storage, 'getItem' | 'setItem'> | undefined;

/** A '1'/'0' setting in storage; `fallback` when unset or storage is unavailable. */
export function readFlag(key: string, fallback: boolean, store: FlagStore = globalThis.localStorage): boolean {
  try {
    const v = store?.getItem(key);
    return v === '1' ? true : v === '0' ? false : fallback;
  } catch {
    return fallback;
  }
}

export function writeFlag(key: string, on: boolean, store: FlagStore = globalThis.localStorage): void {
  try { store?.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** One of `options` from storage; `fallback` when unset, unknown or storage is unavailable. */
export function readChoice<T extends string>(key: string, options: readonly T[], fallback: T,
  store: FlagStore = globalThis.localStorage): T {
  try {
    const v = store?.getItem(key);
    return v !== null && v !== undefined && (options as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeChoice(key: string, value: string, store: FlagStore = globalThis.localStorage): void {
  try { store?.setItem(key, value); } catch { /* storage unavailable */ }
}

/** The human's own-trail rule (a setting; knocked out by default). */
export const SELF_CROSS_KEY = 'territory-wars.self-cross';
export const loadSelfCross = (): SelfCross => readChoice(SELF_CROSS_KEY, SELF_CROSS_MODES, 'die');
const SELF_CROSS_LABEL: Record<SelfCross, string> = { die: 'Knocked out', pass: 'Pass through' };

/** One-line verdict under the results %: a win, or how much of the arena was held. */
export function territoryVerdict(pct: number, won: boolean): string {
  if (won) return 'Conquered the arena';
  if (pct >= 25) return 'Dominated the arena';
  if (pct >= 10) return 'Strong showing';
  if (pct >= 3) return 'Solid patch of land';
  return 'Loop wider next time';
}

/** A random bot-style name that fits the name field, never `current` when there is a choice. */
export function randomName(current: string, rand: () => number = Math.random, names: readonly string[] = NAMES): string {
  const pool = names.filter((n) => n.length <= NAME_MAX && n !== current);
  if (!pool.length) return current;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

export const REDUCED_MOTION_KEY = 'territory-wars.reduced-motion';

/** The steering hint fades out after this many seconds of play. */
export const HINT_SECONDS = 8;

// ---------- DOM ----------

export type StartPrefs = { name: string; difficulty: Difficulty };
export type OverStats = {
  won: boolean; pct: number; kills: number; time: number; newBest: boolean; difficulty: Difficulty;
  /** Best for this difficulty after the run was recorded. */
  best: BestScore | null;
  /** Names of skins this round unlocked. */
  unlocked: string[];
};

export type Tab = 'play' | 'skins' | 'records';

export type RecordsView = {
  bestFor: (difficulty: Difficulty) => BestScore | null;
  lifetime: Lifetime;
  /** In the app the Privacy & ads row opens Google's consent form; a browser shows no ads. */
  native: boolean;
  /** Opens the consent (privacy options) form; resolves false if it couldn't. */
  openPrivacy(): Promise<boolean>;
};

export type PauseHandlers = { resume(): void; restart(): void; home(): void };

/** Puts a native ad in `slot` (shown at once); calls `failed` if none loads. Resolves to a cleanup. */
export type NativeAdSlot = (slot: HTMLElement, failed: () => void) => Promise<() => void>;

/** Whether the HUD minimap is shown (a setting, on by default). */
export const MINIMAP_KEY = 'territory-wars.minimap';

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const DIFFICULTY_SHORT: Record<Difficulty, string> = { easy: 'Easy', normal: 'Norm', hard: 'Hard' };

/** The revive card ignores taps for this long after it opens (it is still popping in). */
export const REVIVE_ARM_MS = 350;

/** How long the revive offer stays open before it gives up by itself. */
export const REVIVE_COUNTDOWN_MS = 5000;

export type ReviveInfo = {
  killerName: string | null;
  cause: DeathCause;
  /** Best score for the current difficulty (before this run). */
  best: BestScore | null;
  /** The difficulty being played; labels the Best tile. */
  difficulty: Difficulty;
  kills: number;
  time: number;
};
export type ReviveHandlers = {
  /** Resolves true once revived; false leaves the offer open. */
  revive(): Promise<boolean>;
  giveUp(): void;
};

export type Screens = {
  /**
   * Home screen: best score (for the selected difficulty), name, the equipped skin (its
   * colour included), difficulty and Play. The tab bar calls onTab with the prefs as picked.
   */
  showStart(
    prefs: StartPrefs,
    skin: Skin,
    bestFor: (difficulty: Difficulty) => BestScore | null,
    onPlay: (prefs: StartPrefs) => void,
    onTab: (tab: Tab, prefs: StartPrefs) => void,
  ): void;
  /** Records & settings: bests per difficulty, lifetime stats, settings and privacy. */
  showRecords(view: RecordsView, onTab: (tab: Tab) => void): void;
  /** Skins: pick a face, unlock more by playing or with an ad. */
  showSkins(view: SkinsView, onTab: (tab: Tab) => void): void;
  /** Overview canvas in the HUD's bottom-right corner. */
  minimap: HTMLCanvasElement;
  /** The in-game HUD; its pause button calls onPause. */
  showHud(onPause: () => void): void;
  /** Pause menu over the frozen game. */
  showPause(handlers: PauseHandlers): void;
  hidePause(): void;
  /** Refreshes the HUD; returns true while the % counter is animating (call tickHud per frame). */
  /** `danger` is the session's sampled danger level (0 when danger warnings are off). */
  updateHud(world: World, now: number, danger?: number): boolean;
  /** Advances the % counter animation; returns true while it is still animating. */
  tickHud(now: number): boolean;
  showOver(stats: OverStats, onAgain: () => void, onHome: () => void, nativeAd?: NativeAdSlot): void;
  /** Revive modal over the (frozen) game and HUD, with a REVIVE_COUNTDOWN_MS countdown. */
  showRevive(info: ReviveInfo, handlers: ReviveHandlers): void;
  hideRevive(): void;
};

type RowEls = { root: HTMLElement; rank: HTMLElement; swatch: HTMLElement; name: HTMLElement; pct: HTMLElement; key: string };

export function createScreens(root: HTMLElement): Screens {
  root.classList.add('tw-ui');

  // ----- shared settings -----
  let reducedPref = readFlag(REDUCED_MOTION_KEY, false);
  const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduceMotion = () => reducedPref || !!motionQuery?.matches;
  const applyReduced = () => {
    root.classList.toggle('tw-reduced-motion', reducedPref);
    // The canvas layers (render.ts prefersReducedMotion) read the flag from <html>.
    document.documentElement.classList.toggle('tw-reduced-motion', reducedPref);
  };
  applyReduced();

  type Toggle = { btn: HTMLButtonElement; sync(): void };
  const toggles: Toggle[] = [];
  const syncAll = () => { for (const t of toggles) t.sync(); };

  // ----- start -----
  const start = el('div', 'tw-screen tw-start');
  const startWrap = el('div', 'tw-start-wrap');
  const startCard = el('div', 'tw-card tw-start-card');
  startCard.append(el('div', 'tw-kicker', 'Casual arcade'));
  startCard.append(el('h1', 'tw-title', 'Territory Wars'));
  startCard.append(el('p', 'tw-tagline', 'Loop out, come home, claim the map.'));
  const bestBox = el('div', 'tw-best');
  const bestLabel = el('div', 'tw-best-label');
  const bestLabelText = el('span');
  bestLabel.append(icon('star'), bestLabelText);
  const bestPct = el('div', 'tw-best-pct tw-num');
  const bestSide = el('div', 'tw-best-side');
  const bestKills = el('div', 'tw-best-kills');
  const bestKillsText = el('span', 'tw-num');
  bestKills.append(icon('flame'), bestKillsText);
  const bestTime = el('div', 'tw-best-time tw-num');
  bestSide.append(bestKills, bestTime);
  const bestEmpty = el('div', 'tw-best-empty-text', 'No best yet — go claim some land!');
  bestBox.append(bestLabel, bestPct, bestSide, bestEmpty);
  startCard.append(bestBox);

  const nameInput = el('input', 'tw-input');
  nameInput.type = 'text';
  nameInput.maxLength = NAME_MAX;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.id = 'tw-name';
  nameInput.enterKeyHint = 'go';
  const nameField = el('div', 'tw-field');
  const diceBtn = button('tw-dice');
  diceBtn.setAttribute('aria-label', 'Random name');
  diceBtn.append(icon('dice'));
  diceBtn.addEventListener('click', () => {
    unlockAudio();
    playTick();
    nameInput.value = randomName(nameInput.value);
  });
  nameField.append(icon('id', 'tw-field-icon'), nameInput, diceBtn);
  startCard.append(labelRow('Your name', el('span', 'tw-label-aside', `max ${NAME_MAX} chars`), 'tw-name'), nameField);

  // The equipped skin sets the colour too; it is changed on the Skins tab, never here.
  const colorName = el('span', 'tw-label-aside tw-color-name');
  const skinRow = button('tw-skin-row');
  const skinCanvas = el('canvas', 'tw-skin-row-canvas');
  skinCanvas.setAttribute('aria-hidden', 'true');
  const skinName = el('span', 'tw-skin-row-name');
  const skinChange = el('span', 'tw-skin-row-change');
  skinChange.append(el('span', undefined, 'Change'), icon('chevron'));
  skinRow.append(skinCanvas, skinName, skinChange);
  startCard.append(labelRow('Skin', colorName), skinRow);

  const diffGroup = el('div', 'tw-segments');
  diffGroup.setAttribute('role', 'radiogroup');
  diffGroup.setAttribute('aria-label', 'Difficulty');
  const diffBtns = DIFFICULTIES.map((d) => {
    const b = button('tw-segment', DIFFICULTY_LABEL[d]);
    b.setAttribute('role', 'radio');
    diffGroup.append(b);
    return b;
  });
  startCard.append(labelRow('Difficulty'), diffGroup);

  const playBtn = button('tw-btn tw-play');
  playBtn.append(icon('play-fill'), el('span', undefined, 'Play'));
  startCard.append(playBtn);
  startWrap.append(startCard);
  start.append(startWrap);

  let chosenDiff: Difficulty = 'normal';
  let bestForCb: (d: Difficulty) => BestScore | null = () => null;
  const showBest = (best: BestScore | null) => {
    if (best) {
      setText(bestPct, formatPct(best.pct, 2));
      setText(bestKillsText, `${best.kills} ${best.kills === 1 ? 'kill' : 'kills'}`);
      setText(bestTime, `${formatTime(best.time)} survived`);
    } else {
      setText(bestPct, '—');
    }
    bestBox.classList.toggle('tw-best-empty', !best);
  };
  const pickDiff = (d: Difficulty) => {
    chosenDiff = d;
    diffBtns.forEach((b, j) => {
      const on = DIFFICULTIES[j] === d;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    setText(bestLabelText, `Best score · ${DIFFICULTY_LABEL[d]}`);
    showBest(bestForCb(d));
  };
  // Sound only on user picks, not when showStart restores the saved choice.
  const userPickDiff = (d: Difficulty) => { unlockAudio(); playSelect(d); pickDiff(d); };
  diffBtns.forEach((b, i) => b.addEventListener('click', () => userPickDiff(DIFFICULTIES[i])));
  /** Arrow keys move a radiogroup's choice: +1 right/down, -1 left/up, 0 otherwise. */
  const arrowStep = (e: KeyboardEvent) =>
    e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  diffGroup.addEventListener('keydown', (e) => {
    const d = arrowStep(e);
    if (!d) return;
    e.preventDefault();
    const n = diffBtns.length;
    const i = (DIFFICULTIES.indexOf(chosenDiff) + d + n) % n;
    userPickDiff(DIFFICULTIES[i]);
    diffBtns[i].focus();
  });
  let onPlayCb: ((p: StartPrefs) => void) | null = null;
  let onStartTab: ((t: Tab, p: StartPrefs) => void) | null = null;
  const showSkin = (skin: Skin) => {
    const c = PALETTE.players[skin.color];
    paintSkin(skinCanvas, skin, 'idle', 52);
    setText(skinName, skin.name);
    setText(colorName, COLOR_NAMES[skin.color] ?? '');
    skinRow.setAttribute('aria-label', `Skin: ${skin.name}, ${COLOR_NAMES[skin.color] ?? ''}. Change skin`);
    playBtn.style.setProperty('--btn', c.base);
    playBtn.style.setProperty('--btn-lip', c.lip);
  };
  const currentPrefs = (): StartPrefs => ({ name: cleanName(nameInput.value), difficulty: chosenDiff });
  const submit = () => {
    if (!onPlayCb) return;
    const cb = onPlayCb;
    onPlayCb = onStartTab = null; // one click = one game
    cb(currentPrefs());
  };
  playBtn.addEventListener('click', submit);
  skinRow.addEventListener('click', () => {
    const cb = onStartTab;
    if (!cb) return;
    onPlayCb = onStartTab = null;
    unlockAudio();
    playTick();
    cb('skins', currentPrefs());
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  // ----- records & settings -----
  const records = el('div', 'tw-screen tw-records');
  records.setAttribute('role', 'region');
  records.setAttribute('aria-labelledby', 'tw-records-title');
  const recInner = el('div', 'tw-records-inner');
  const recHead = el('header', 'tw-records-head');
  const backBtn = button('tw-icon-btn tw-back');
  backBtn.setAttribute('aria-label', 'Back to home');
  backBtn.append(icon('back'));
  const recTitles = el('div', 'tw-records-titles');
  const recTitle = el('h2', 'tw-records-title', 'Records & Settings');
  recTitle.id = 'tw-records-title';
  recTitles.append(recTitle, el('div', 'tw-records-sub', 'Territory Wars'));
  recHead.append(backBtn, recTitles);
  const sectionHead = (name: IconName, text: string) => {
    const h = el('h3', 'tw-section-head');
    h.append(icon(name), el('span', undefined, text));
    return h;
  };
  const bestList = el('div', 'tw-best-list');
  const bestCards = DIFFICULTIES.map((d) => {
    const card = el('section', 'tw-best-card');
    card.dataset.difficulty = d;
    card.setAttribute('aria-label', `${DIFFICULTY_LABEL[d]} personal best`);
    const top = el('div', 'tw-best-card-top');
    const highest = el('span', 'tw-highest');
    highest.append(icon('trophy'), el('span', undefined, 'Highest best'));
    top.append(el('span', 'tw-diff-chip', DIFFICULTY_LABEL[d]), highest);
    const owned = el('div', 'tw-best-card-label', 'Territory owned');
    const pctEl = el('div', 'tw-best-card-pct tw-num');
    const tiles = el('div', 'tw-best-card-tiles');
    const tile = (label: string) => {
      const t = el('div', 'tw-mini-tile');
      const v = el('div', 'tw-mini-value tw-num');
      t.append(el('div', 'tw-mini-label', label), v);
      tiles.append(t);
      return v;
    };
    const kills = tile('Kills');
    const time = tile('Survived');
    const empty = el('p', 'tw-best-card-none', 'No best yet — go claim some land!');
    card.append(top, owned, pctEl, tiles, empty);
    bestList.append(card);
    return { card, highest, pctEl, kills, time, empty };
  });

  const lifeTiles = el('div', 'tw-life');
  const lifeStat = (label: string) => {
    const t = el('div', 'tw-life-stat');
    const v = el('div', 'tw-life-value tw-num', '0');
    t.append(v, el('div', 'tw-life-label', label));
    lifeTiles.append(t);
    return v;
  };
  const lifeGames = lifeStat('Games');
  const lifeKills = lifeStat('Total kills');
  const lifeRevives = lifeStat('Revives');

  let minimapOn = readFlag(MINIMAP_KEY, true);
  const settingsList = el('div', 'tw-settings');
  const settingRow = (name: IconName, label: string, get: () => boolean, set: (on: boolean) => void,
    parent: HTMLElement = settingsList) => {
    const b = button('tw-setting');
    b.setAttribute('role', 'switch');
    const knob = el('span', 'tw-switch');
    knob.setAttribute('aria-hidden', 'true');
    b.append(icon(name), el('span', 'tw-setting-label', label), knob);
    b.addEventListener('click', () => { set(!get()); syncAll(); });
    toggles.push({ btn: b, sync: () => b.setAttribute('aria-checked', String(get())) });
    parent.append(b);
  };
  settingRow('sound', 'Sound effects', () => !isMuted(), (on) => { unlockAudio(); setMuted(!on); playTick(); });
  settingRow('vibrate', 'Vibration', isVibrationOn, (on) => setVibrationOn(on));
  settingRow('motion-off', 'Reduced motion', () => reducedPref, (on) => {
    reducedPref = on;
    writeFlag(REDUCED_MOTION_KEY, on);
    applyReduced();
  });
  settingRow('map', 'Show minimap', () => minimapOn, (on) => {
    minimapOn = on;
    writeFlag(MINIMAP_KEY, on);
  });
  // Own-trail rule: a choice (more modes may follow), so a picker rather than a switch. The
  // native <select> covers the whole row (invisibly), so a tap anywhere opens the OS picker.
  const selfCrossRow = el('div', 'tw-setting tw-setting-choice');
  const selfCrossSelect = el('select', 'tw-choice');
  selfCrossSelect.setAttribute('aria-label', 'When you cross your own trail');
  for (const m of SELF_CROSS_MODES) {
    const o = el('option', undefined, SELF_CROSS_LABEL[m]);
    o.value = m;
    selfCrossSelect.append(o);
  }
  const selfCrossValue = el('span', 'tw-choice-value');
  const showSelfCross = (m: SelfCross) => {
    selfCrossSelect.value = m;
    setText(selfCrossValue, SELF_CROSS_LABEL[m]);
    selfCrossRow.dataset.value = m;
  };
  showSelfCross(loadSelfCross());
  selfCrossSelect.addEventListener('change', () => {
    const m = selfCrossSelect.value as SelfCross;
    writeChoice(SELF_CROSS_KEY, m);
    showSelfCross(m);
    playTick();
  });
  selfCrossRow.append(icon('x-circle'), el('span', 'tw-setting-label', 'Own trail'), selfCrossValue,
    icon('chevron', 'tw-chevron'), selfCrossSelect);
  settingsList.append(selfCrossRow);
  // Privacy & ads: Google's consent form in the app; a browser build shows no ads at all.
  const privacyBtn = button('tw-setting tw-privacy');
  const privacyIcon = el('span', 'tw-privacy-icon');
  privacyIcon.append(icon('shield'));
  const privacyText = el('span', 'tw-privacy-text');
  const privacySub = el('span', 'tw-privacy-sub');
  privacyText.append(el('span', 'tw-setting-label', 'Privacy & ads'), privacySub);
  privacyBtn.append(privacyIcon, privacyText, icon('chevron', 'tw-chevron'));
  settingsList.append(privacyBtn);
  let recordsView: RecordsView | null = null;
  privacyBtn.addEventListener('click', async () => {
    const v = recordsView;
    if (!v?.native) return;
    privacyBtn.disabled = true;
    const ok = await v.openPrivacy().catch(() => false);
    privacyBtn.disabled = false;
    if (!ok) setText(privacySub, 'No ad choices to change in your region');
  });
  const recFoot = el('footer', 'tw-records-foot');
  recFoot.append(el('div', 'tw-foot-strong', 'Territory Wars · Ages 13+'),
    el('div', undefined, 'No in-app purchases · Ad-supported fair play'));
  recInner.append(recHead, sectionHead('trophy', 'Personal bests'), bestList,
    el('h3', 'tw-section-label', 'Lifetime career'), lifeTiles,
    sectionHead('gear', 'Settings'), settingsList, recFoot);
  records.append(recInner);
  let onBackCb: (() => void) | null = null;
  const leaveRecords = () => {
    const cb = onBackCb;
    onBackCb = null;
    cb?.();
  };
  backBtn.addEventListener('click', leaveRecords);
  records.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); leaveRecords(); } });

  // ----- HUD -----
  const hud = el('div', 'tw-hud');
  const area = el('div', 'tw-area');
  const areaHead = el('div', 'tw-area-head');
  const areaDot = el('span', 'tw-dot');
  areaHead.append(areaDot, el('span', undefined, 'My area'));
  const pctEl = el('div', 'tw-pct tw-num');
  const pctNum = el('span', undefined, '0.00');
  pctEl.append(pctNum, el('span', 'tw-pct-sign', '%'));
  const areaFoot = el('div', 'tw-area-foot');
  const burnTag = el('span', 'tw-burn-tag');
  burnTag.append(icon('flame'), el('span', undefined, 'Burning'));
  burnTag.hidden = true;
  const killsEl = el('span', 'tw-area-stat tw-num');
  const killsNum = el('span', undefined, '0');
  killsEl.append(icon('swords'), killsNum);
  killsEl.setAttribute('aria-label', 'Kills');
  const timeEl = el('span', 'tw-area-stat tw-num');
  const timeNum = el('span', undefined, '0:00');
  timeEl.append(icon('timer'), timeNum);
  timeEl.setAttribute('aria-label', 'Time');
  areaFoot.append(burnTag, killsEl, timeEl);
  area.append(areaHead, pctEl, areaFoot);

  const boardBox = el('div', 'tw-board-box');
  const boardHead = el('div', 'tw-board-head');
  boardHead.append(icon('trophy'), el('span', undefined, 'Leaderboard'));
  const board = el('ol', 'tw-board');
  board.setAttribute('aria-label', 'Leaderboard');
  boardBox.append(boardHead, board);
  const pctTween = createPctTween(300);
  const rowEls: RowEls[] = [];
  for (let i = 0; i < 6; i++) {
    const r = el('li', 'tw-row');
    const rank = el('span', 'tw-rank');
    const swatch = el('span', 'tw-row-swatch');
    const name = el('span', 'tw-row-name');
    const p = el('span', 'tw-row-pct tw-num');
    r.append(rank, swatch, name, p);
    r.hidden = true;
    board.append(r);
    rowEls.push({ root: r, rank, swatch, name, pct: p, key: '' });
  }
  const crown = icon('crown-fill', 'tw-crown');
  crown.removeAttribute('aria-hidden');
  crown.setAttribute('role', 'img');
  crown.setAttribute('aria-label', '1');

  const alerts = el('div', 'tw-alerts');
  alerts.setAttribute('role', 'status');
  // Both pills share one spot and cross-fade (in 200 ms, out 300 ms; see .tw-on).
  const burnPill = el('div', 'tw-burn-pill');
  burnPill.append(icon('flame'), el('span', undefined, 'Trail on fire — get home!'), icon('flame'));
  const dangerPill = el('div', 'tw-danger-pill');
  const heart = icon('heart-fill', 'tw-heart');
  const meter = el('span', 'tw-danger-meter');
  const segs: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) { const sg = el('span', 'tw-danger-seg'); segs.push(sg); meter.append(sg); }
  dangerPill.append(heart, el('span', undefined, 'Far from home'), meter);
  alerts.append(dangerPill, burnPill);
  /** Last written HUD alert state, so the DOM is touched only on change. */
  let shownBurn = false, shownDanger = false, shownSegs = -1, shownBeat = -1;
  const setAlerts = (burning: boolean, danger: number) => {
    const showDanger = !burning && danger >= DANGER_SHOW;
    if (burning !== shownBurn) { shownBurn = burning; burnPill.classList.toggle('tw-on', burning); }
    if (showDanger !== shownDanger) { shownDanger = showDanger; dangerPill.classList.toggle('tw-on', showDanger); }
    if (!showDanger) return; // keep the last meter while it fades out
    const n = dangerSegments(danger);
    if (n !== shownSegs) { shownSegs = n; segs.forEach((sg, i) => sg.classList.toggle('tw-lit', i < n)); }
    const beat = heartbeatSeconds(danger);
    if (beat !== shownBeat) { shownBeat = beat; dangerPill.style.setProperty('--tw-beat', `${beat}s`); }
  };
  const shieldToast = el('div', 'tw-shield-toast');
  shieldToast.append(icon('shield'), el('span', undefined, 'Revived! '), el('b', undefined, `Shield ${CONFIG.REVIVE_PROTECT_S}s`));
  shieldToast.hidden = true;
  shieldToast.setAttribute('role', 'status');

  const steerHint = el('div', 'tw-steer-hint', 'Drag anywhere to steer');
  const minimapWrap = el('div', 'tw-minimap-wrap');
  const minimap = el('canvas', 'tw-minimap');
  minimap.setAttribute('aria-label', 'Map of the whole arena');
  minimap.setAttribute('role', 'img');
  minimapWrap.append(minimap, el('span', 'tw-minimap-label', 'Map'));
  const pauseBtn = button('tw-pause-btn');
  pauseBtn.setAttribute('aria-label', 'Pause');
  pauseBtn.append(icon('pause'));
  let onPauseCb: (() => void) | null = null;
  pauseBtn.addEventListener('click', () => onPauseCb?.());
  hud.append(area, pauseBtn, boardBox, alerts, shieldToast, steerHint, minimapWrap);
  let hudColor = -1;

  // ----- game over -----
  const over = el('div', 'tw-screen tw-over');
  const overWrap = el('div', 'tw-over-wrap');
  const overCard = el('div', 'tw-card tw-over-card');
  const overChips = el('div', 'tw-over-chips');
  const overDiff = el('span', 'tw-diff-chip');
  const newBestEl = el('span', 'tw-new-best');
  newBestEl.append(icon('star'), el('span', undefined, 'New best!'));
  overChips.append(overDiff, newBestEl);
  const overTitle = el('h2', 'tw-over-title');
  const overPanel = el('div', 'tw-over-panel');
  const overPanelText = el('div', 'tw-over-panel-text');
  const overPct = el('div', 'tw-over-pct tw-num');
  const overPctNum = el('span');
  overPct.append(overPctNum, el('span', 'tw-pct-sign', '%'));
  const overVerdict = el('div', 'tw-over-verdict');
  const overVerdictText = el('span');
  overVerdict.append(icon('trend'), overVerdictText);
  overPanelText.append(el('div', 'tw-over-pct-label', 'Territory owned'), overPct, overVerdict);
  // The final arena, copied from the HUD minimap when the round ends.
  const overMap = el('canvas', 'tw-over-map');
  overMap.setAttribute('role', 'img');
  overMap.setAttribute('aria-label', 'The arena at the end of the round');
  overPanel.append(overPanelText, overMap);
  const overStats = el('div', 'tw-tiles');
  const overKills = statTile(overStats, 'swords', 'Kills').value;
  const overTime = statTile(overStats, 'timer', 'Time').value;
  const overBest = statTile(overStats, 'star', 'Best');
  overCard.append(overChips, overTitle, overPanel, overStats);
  const againBtn = button('tw-btn tw-again');
  againBtn.append(icon('play-fill'), el('span', undefined, 'Play again'));
  const homeBtn = button('tw-btn tw-btn-secondary tw-home');
  homeBtn.append(icon('home'), el('span', undefined, 'Home'));
  const overUnlocked = el('p', 'tw-over-unlocked');
  overCard.append(overUnlocked);
  // Native ad card under the buttons (app only); hidden again if no ad loads.
  const adBox = el('aside', 'tw-native-ad');
  adBox.setAttribute('aria-label', 'Sponsored');
  const adSlot = el('div', 'tw-native-slot');
  adBox.append(el('div', 'tw-native-label', 'Sponsored'), adSlot);
  adBox.hidden = true;
  let adCleanup: (() => void) | null = null;
  let adToken = 0;
  const dropAd = () => {
    adToken++;
    adCleanup?.();
    adCleanup = null;
    adBox.hidden = true;
  };
  overWrap.append(overCard, againBtn, homeBtn, adBox);
  over.append(overWrap);
  const copyMinimap = () => {
    const size = 96;
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    overMap.width = overMap.height = Math.round(size * dpr);
    const ctx = overMap.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, overMap.width, overMap.height);
    if (minimap.width > 0) ctx.drawImage(minimap, 0, 0, overMap.width, overMap.height);
    overMap.hidden = !minimapOn || minimap.width === 0;
  };
  let onAgainCb: (() => void) | null = null;
  let onHomeCb: (() => void) | null = null;
  const leaveOver = (which: 'again' | 'home') => {
    const cb = which === 'again' ? onAgainCb : onHomeCb;
    onAgainCb = onHomeCb = null; // one click = one action
    cb?.();
  };
  againBtn.addEventListener('click', () => leaveOver('again'));
  homeBtn.addEventListener('click', () => leaveOver('home'));

  // ----- revive -----
  const revive = el('div', 'tw-screen tw-revive');
  revive.setAttribute('role', 'dialog');
  revive.setAttribute('aria-modal', 'true');
  revive.setAttribute('aria-labelledby', 'tw-revive-title');
  const reviveCard = el('div', 'tw-card tw-revive-card');
  const closeBtn = button('tw-icon-btn tw-revive-close');
  closeBtn.append(icon('close'));
  closeBtn.setAttribute('aria-label', 'Close and view results');
  const pill = el('div', 'tw-ko-pill');
  pill.append(icon('x-circle'), el('span', undefined, 'Knocked out!'));
  const reviveTitle = el('h2', 'tw-revive-title', 'Knocked out!');
  reviveTitle.id = 'tw-revive-title';
  const reviveSub = el('p', 'tw-revive-sub');
  const ring = el('div', 'tw-ring');
  ring.setAttribute('role', 'timer');
  ring.setAttribute('aria-label', 'Seconds left to revive');
  const RING_R = 44;
  const RING_C = 2 * Math.PI * RING_R;
  const ringSvg = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  ringSvg.append(svg('circle', { class: 'tw-ring-track', cx: '50', cy: '50', r: String(RING_R) }));
  const ringArc = svg('circle', {
    class: 'tw-ring-arc', cx: '50', cy: '50', r: String(RING_R),
    'stroke-dasharray': RING_C.toFixed(2), transform: 'rotate(-90 50 50)',
  });
  ringSvg.append(ringArc);
  const ringNum = el('div', 'tw-ring-num tw-num', '5');
  ring.append(ringSvg, ringNum, el('div', 'tw-ring-sec', 'SEC'));
  const reviveStats = el('div', 'tw-tiles');
  const rBest = statTile(reviveStats, null, 'Best');
  const rKills = statTile(reviveStats, 'swords', 'Kills').value;
  const rTime = statTile(reviveStats, 'timer', 'Time').value;
  const reviveBtn = button('tw-btn tw-revive-btn');
  reviveBtn.append(icon('video', 'tw-revive-icon'), el('span', undefined, 'Revive'));
  // In the app the revive costs a rewarded ad; in a browser it is free, so no ad tag there.
  const reviveCaption = el('p', 'tw-revive-caption');
  if (isNative) {
    reviveCaption.append(el('span', 'tw-ad-tag', 'AD'), document.createTextNode(' Watch a short ad · '));
    reviveBtn.setAttribute('aria-label', 'Revive: watch a short ad');
  }
  reviveCaption.append(document.createTextNode(`Keep 100% land · ${CONFIG.REVIVE_PROTECT_S}s shield`));
  const noThanks = button('tw-link', 'No thanks, view results');
  reviveCard.append(closeBtn, pill, reviveTitle, reviveSub, ring, reviveStats, reviveBtn, reviveCaption, noThanks);
  if (!isNative) reviveCard.append(el('p', 'tw-keys-hint', 'Enter to revive · Esc to skip'));
  revive.append(reviveCard);
  revive.hidden = true;

  // One offer at a time: `offer` is null once it is settled (revived or given up).
  let offer: { handlers: ReviveHandlers; remaining: number; deadline: number; pending: boolean } | null = null;
  let reviveFrame: number | null = null;
  /** Taps are ignored while the card pops in, so a steering tap can't land on a button. */
  let armTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (armTimer !== null) clearTimeout(armTimer);
    armTimer = null;
    revive.classList.remove('tw-arming');
  };
  const stopCountdown = () => {
    if (reviveFrame !== null) cancelAnimationFrame(reviveFrame);
    reviveFrame = null;
  };
  const drawCountdown = (remaining: number) => {
    setText(ringNum, String(countdownSeconds(remaining)));
    ringArc.setAttribute('stroke-dashoffset', (RING_C * (1 - countdownFraction(remaining, REVIVE_COUNTDOWN_MS))).toFixed(2));
  };
  const closeRevive = () => {
    stopCountdown();
    disarm();
    offer = null;
    revive.hidden = true;
    document.removeEventListener('keydown', onReviveKey);
    document.removeEventListener('visibilitychange', onReviveVisibility);
  };
  const giveUp = () => {
    if (!offer) return;
    const h = offer.handlers;
    closeRevive();
    h.giveUp();
  };
  const tickCountdown = (now: number) => {
    reviveFrame = null;
    if (!offer || offer.pending) return;
    offer.remaining = offer.deadline - now;
    drawCountdown(offer.remaining);
    if (offer.remaining <= 0) { giveUp(); return; }
    reviveFrame = requestAnimationFrame(tickCountdown);
  };
  const runCountdown = () => {
    if (!offer) return;
    offer.deadline = performance.now() + offer.remaining;
    stopCountdown();
    // A hidden tab keeps the clock paused; onReviveVisibility starts it when shown again.
    if (document.hidden) return;
    reviveFrame = requestAnimationFrame(tickCountdown);
  };
  /** A hidden tab must not burn the countdown: pause with what is left, resume on return. */
  function onReviveVisibility() {
    if (!offer || offer.pending) return; // a pending revive has the clock stopped already
    if (document.hidden) {
      if (reviveFrame === null) return;
      offer.remaining = pausedRemaining(offer.deadline, performance.now());
      stopCountdown();
    } else if (reviveFrame === null) {
      runCountdown();
    }
  }
  const setPending = (on: boolean) => {
    reviveBtn.disabled = on;
    reviveCard.classList.toggle('tw-pending', on);
  };
  const doRevive = async () => {
    const o = offer;
    if (!o || o.pending) return; // guards double clicks / Enter + click
    o.pending = true;
    stopCountdown(); // the clock waits while the revive is being requested
    setPending(true);
    let ok = false;
    try { ok = await o.handlers.revive(); } catch { ok = false; }
    if (offer !== o) return; // gave up meanwhile
    setPending(false);
    if (ok) { closeRevive(); return; }
    o.pending = false;
    runCountdown();
  };
  function onReviveKey(e: KeyboardEvent) {
    if (!offer) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      giveUp();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && revive.contains(e.target))) {
      // A focused modal button handles Enter itself (as a click).
      e.preventDefault();
      void doRevive();
    }
  }
  reviveBtn.addEventListener('click', () => { void doRevive(); });
  noThanks.addEventListener('click', giveUp);
  closeBtn.addEventListener('click', giveUp);

  // ----- pause -----
  const pause = el('div', 'tw-screen tw-pause');
  pause.setAttribute('role', 'dialog');
  pause.setAttribute('aria-modal', 'true');
  pause.setAttribute('aria-labelledby', 'tw-pause-title');
  const pauseCard = el('div', 'tw-card tw-pause-card');
  const pauseTitle = el('h2', 'tw-pause-title', 'Paused');
  pauseTitle.id = 'tw-pause-title';
  const resumeBtn = button('tw-btn tw-resume');
  resumeBtn.append(icon('play-fill'), el('span', undefined, 'Resume'));
  const restartBtn = button('tw-btn tw-btn-secondary tw-restart');
  restartBtn.append(icon('restart'), el('span', undefined, 'Restart'));
  const pauseHomeBtn = button('tw-btn tw-btn-secondary tw-pause-home');
  pauseHomeBtn.append(icon('home'), el('span', undefined, 'Home'));
  const pauseSettings = el('div', 'tw-settings tw-pause-settings');
  settingRow('sound', 'Sound effects', () => !isMuted(), (on) => { unlockAudio(); setMuted(!on); playTick(); }, pauseSettings);
  pauseCard.append(pauseTitle, resumeBtn, restartBtn, pauseHomeBtn, pauseSettings);
  pause.append(pauseCard);
  pause.hidden = true;
  let pauseHandlers: PauseHandlers | null = null;
  const leavePause = (which: keyof PauseHandlers) => {
    const h = pauseHandlers;
    if (!h) return;
    closePause();
    h[which]();
  };
  function onPauseKey(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      leavePause('resume');
    }
  }
  const closePause = () => {
    pauseHandlers = null;
    pause.hidden = true;
    document.removeEventListener('keydown', onPauseKey);
  };
  resumeBtn.addEventListener('click', () => leavePause('resume'));
  restartBtn.addEventListener('click', () => leavePause('restart'));
  pauseHomeBtn.addEventListener('click', () => leavePause('home'));

  // ----- skins -----
  const skins = createSkinsScreen(() => onTabCb?.('play'));

  // ----- tab bar (home, skins, records) -----
  const tabbar = el('nav', 'tw-tabbar');
  tabbar.setAttribute('aria-label', 'Main');
  const TABS: { tab: Tab; label: string; name: IconName }[] = [
    { tab: 'play', label: 'Play', name: 'play-circle' },
    { tab: 'skins', label: 'Skins', name: 'palette' },
    { tab: 'records', label: 'Records', name: 'chart' },
  ];
  const tabBtns = TABS.map((t) => {
    const b = button('tw-tab');
    b.append(icon(t.name), el('span', undefined, t.label));
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-current') === 'page') return;
      unlockAudio();
      playTick();
      onTabCb?.(t.tab);
    });
    tabbar.append(b);
    return b;
  });
  let onTabCb: ((t: Tab) => void) | null = null;
  const setTab = (tab: Tab, cb: (t: Tab) => void) => {
    onTabCb = (t) => { onTabCb = null; cb(t); }; // one tap = one navigation
    TABS.forEach((t, i) => {
      if (t.tab === tab) tabBtns[i].setAttribute('aria-current', 'page');
      else tabBtns[i].removeAttribute('aria-current');
    });
  };

  root.append(hud, start, skins.root, records, over, revive, pause, tabbar);
  const all = [start, skins.root, records, hud, over];
  const menus = [start, skins.root, records];
  const only = (shown: HTMLElement) => {
    for (const e of all) e.hidden = e !== shown;
    tabbar.hidden = !menus.includes(shown);
    if (offer) closeRevive();
    if (pauseHandlers) closePause();
    if (shown !== over) dropAd();
    if (shown !== hud) onPauseCb = null;
  };
  syncAll();
  only(start);

  return {
    minimap,
    showStart(prefs, skin, bestFor, onPlay, onTab) {
      bestForCb = bestFor;
      pickDiff(prefs.difficulty);
      nameInput.value = prefs.name;
      showSkin(skin);
      onPlayCb = onPlay;
      onStartTab = onTab;
      only(start);
      setTab('play', (t) => {
        const cb = onStartTab;
        onPlayCb = onStartTab = null;
        cb?.(t, currentPrefs());
      });
      start.scrollTop = 0;
      playBtn.focus({ preventScroll: true });
    },
    showRecords(view, onTab) {
      recordsView = view;
      const bests: Partial<Record<Difficulty, BestScore | null>> = {};
      for (const d of DIFFICULTIES) bests[d] = view.bestFor(d);
      const top = highestBest(bests);
      DIFFICULTIES.forEach((d, i) => {
        const b = bests[d] ?? null;
        const c = bestCards[i];
        c.card.classList.toggle('tw-best-card-empty', !b);
        c.highest.hidden = top !== d;
        setText(c.pctEl, b ? formatPct(b.pct, 1) : '—');
        setText(c.kills, b ? String(b.kills) : '—');
        setText(c.time, b ? formatTime(b.time) : '—');
      });
      setText(lifeGames, String(view.lifetime.games));
      setText(lifeKills, String(view.lifetime.totalKills));
      setText(lifeRevives, String(view.lifetime.revives));
      setText(privacySub, view.native ? 'Ad preferences · Manage consent' : 'Ads only run in the Android app');
      privacyBtn.setAttribute('aria-disabled', String(!view.native));
      privacyBtn.classList.toggle('tw-row-off', !view.native);
      syncAll();
      only(records);
      setTab('records', onTab);
      onBackCb = () => onTabCb?.('play');
      records.scrollTop = 0;
      backBtn.focus({ preventScroll: true });
    },
    showSkins(view, onTab) {
      skins.show(view);
      only(skins.root);
      setTab('skins', onTab);
      skins.focus();
    },
    showHud(onPause) {
      for (const r of rowEls) { r.root.hidden = true; r.key = ''; }
      pctTween.snap(0);
      setText(pctNum, '0.00');
      setText(killsNum, '0');
      setText(timeNum, '0:00');
      shieldToast.hidden = burnTag.hidden = true;
      setAlerts(false, 0);
      area.classList.remove('tw-burning');
      steerHint.classList.remove('tw-gone');
      hudColor = -1;
      minimapWrap.hidden = !minimapOn;
      syncAll();
      only(hud);
      onPauseCb = onPause;
    },
    showPause(handlers) {
      if (offer) return; // the revive offer owns the screen
      pauseHandlers = handlers;
      syncAll();
      pause.hidden = false;
      document.addEventListener('keydown', onPauseKey);
      resumeBtn.focus({ preventScroll: true });
    },
    hidePause() {
      if (pauseHandlers) closePause();
    },
    tickHud(now) {
      setText(pctNum, Math.max(0, pctTween.value(now)).toFixed(2));
      return pctTween.active(now);
    },
    updateHud(world, now, danger = 0) {
      const human = world.players[world.humanId];
      const p = pct(world, human.id);
      if (reduceMotion()) pctTween.snap(p);
      else pctTween.set(p, now);
      setText(pctNum, Math.max(0, pctTween.value(now)).toFixed(2));
      setText(killsNum, String(human.kills));
      setText(timeNum, formatTime(world.time));
      if (hudColor !== human.colorIndex) {
        hudColor = human.colorIndex;
        areaDot.style.background = PALETTE.players[hudColor % PALETTE.players.length].base;
      }
      const a = hudAlerts(human, world.time);
      burnTag.hidden = !a.burning;
      setAlerts(a.burning, danger);
      area.classList.toggle('tw-burning', a.burning);
      shieldToast.hidden = !a.shielded;
      steerHint.classList.toggle('tw-gone', world.time > HINT_SECONDS);
      const rows = buildLeaderboard(boardEntries(world));
      rowEls.forEach((r, i) => {
        const row = rows[i];
        if (!row) { r.root.hidden = true; return; }
        r.root.hidden = false;
        if (row.leader) { if (crown.parentElement !== r.rank) r.rank.replaceChildren(crown); }
        else setText(r.rank, String(row.rank));
        setText(r.name, row.isHuman ? 'You' : row.name);
        setText(r.pct, formatPct(row.pct, 1));
        const key = `${row.colorIndex}|${row.isHuman}|${row.leader}`;
        if (r.key !== key) {
          r.key = key;
          r.swatch.style.background = PALETTE.players[row.colorIndex % PALETTE.players.length].base;
          r.root.classList.toggle('tw-you', row.isHuman);
          r.root.classList.toggle('tw-leader', row.leader);
        }
      });
      return pctTween.active(now);
    },
    showOver(s, onAgain, onHome, nativeAd) {
      newBestEl.hidden = !s.newBest;
      setText(overTitle, s.won ? 'You won!' : 'Game over');
      setText(overDiff, DIFFICULTY_LABEL[s.difficulty]);
      overDiff.dataset.difficulty = s.difficulty;
      over.classList.toggle('tw-won', s.won);
      over.classList.toggle('tw-is-new-best', s.newBest);
      setText(overPctNum, Math.max(0, s.pct).toFixed(2));
      setText(overVerdictText, territoryVerdict(s.pct, s.won));
      setText(overKills, String(s.kills));
      setText(overTime, formatTime(s.time));
      setText(overBest.value, s.best ? formatPct(s.best.pct, 1) : '—');
      copyMinimap();
      setText(overUnlocked, s.unlocked.length ? `New skin unlocked: ${s.unlocked.join(', ')}!` : '');
      overUnlocked.hidden = !s.unlocked.length;
      onAgainCb = onAgain;
      onHomeCb = onHome;
      only(over);
      if (nativeAd) {
        const token = ++adToken;
        adBox.hidden = false;
        void nativeAd(adSlot, () => { if (token === adToken) adBox.hidden = true; }).then((cleanup) => {
          if (token === adToken) adCleanup = cleanup;
          else cleanup();
        });
      }
      againBtn.focus({ preventScroll: true });
    },
    showRevive(info, handlers) {
      if (offer) closeRevive();
      const sub = reviveSubtitle(info.cause, info.killerName);
      reviveSub.replaceChildren(document.createTextNode(sub.pre));
      if (sub.name) reviveSub.append(el('b', undefined, sub.name), document.createTextNode(sub.post));
      setText(rBest.label, `Best · ${DIFFICULTY_SHORT[info.difficulty]}`);
      setText(rBest.value, info.best ? formatPct(info.best.pct, 1) : '—');
      setText(rKills, String(info.kills));
      setText(rTime, formatTime(info.time));
      offer = { handlers, remaining: REVIVE_COUNTDOWN_MS, deadline: 0, pending: false };
      setPending(false);
      drawCountdown(REVIVE_COUNTDOWN_MS);
      disarm();
      revive.classList.add('tw-arming');
      armTimer = setTimeout(disarm, REVIVE_ARM_MS);
      revive.hidden = false;
      document.addEventListener('keydown', onReviveKey);
      document.addEventListener('visibilitychange', onReviveVisibility);
      reviveBtn.focus({ preventScroll: true });
      runCountdown();
    },
    hideRevive() {
      if (offer) closeRevive();
    },
  };
}
