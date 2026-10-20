import { COLOR_NAMES, PALETTE } from '../game/palette';
import { isMuted, playSelect, playTick, setMuted, unlockAudio } from '../game/sound';
import { isNative, isVibrationOn, setVibrationOn } from '../native/platform';
import { pct } from '../sim/world';
import { CONFIG, DIFFICULTIES, type Difficulty } from '../sim/config';
import type { DeathCause, Player, World } from '../sim/types';
import type { BestScore } from './best';

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

export const REDUCED_MOTION_KEY = 'territory-wars.reduced-motion';

/** The steering hint fades out after this many seconds of play. */
export const HINT_SECONDS = 8;

// ---------- DOM ----------

export type StartPrefs = { name: string; color: number; difficulty: Difficulty };
export type OverStats = {
  won: boolean; pct: number; kills: number; time: number; newBest: boolean; difficulty: Difficulty;
  /** Best for this difficulty after the run was recorded. */
  best: BestScore | null;
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const DIFFICULTY_SHORT: Record<Difficulty, string> = { easy: 'Easy', normal: 'Norm', hard: 'Hard' };

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
   * Home screen: best score (for the selected difficulty), name, colour, difficulty and Play.
   * Records opens the records & settings screen with the prefs as currently picked.
   */
  showStart(
    prefs: StartPrefs,
    bestFor: (difficulty: Difficulty) => BestScore | null,
    onPlay: (prefs: StartPrefs) => void,
    onRecords: (prefs: StartPrefs) => void,
  ): void;
  /** Records & settings: personal bests per difficulty and the settings toggles. */
  showRecords(bestFor: (difficulty: Difficulty) => BestScore | null, onBack: () => void): void;
  /** Overview canvas in the HUD's bottom-right corner. */
  minimap: HTMLCanvasElement;
  showHud(): void;
  /** Refreshes the HUD; returns true while the % counter is animating (call tickHud per frame). */
  updateHud(world: World, now: number): boolean;
  /** Advances the % counter animation; returns true while it is still animating. */
  tickHud(now: number): boolean;
  showOver(stats: OverStats, onAgain: () => void, onHome: () => void): void;
  /** Revive modal over the (frozen) game and HUD, with a REVIVE_COUNTDOWN_MS countdown. */
  showRevive(info: ReviveInfo, handlers: ReviveHandlers): void;
  hideRevive(): void;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

function button(cls: string, text?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** 24×24 line icons (stroke = currentColor); names ending in "-fill" are solid shapes. */
const ICONS = {
  'play-fill': 'M8 5.5v13l10.5-6.5z',
  'star': 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.75 1-5.8L3.5 9.7l5.9-.9z',
  'flame': 'M12 3c.6 3.4 5 5.6 5 10.5a5 5 0 0 1-10 0c0-2.4 1.4-4 2.5-5 .2 1.7 1 2.8 2 3.1.4-3-.5-5.6.5-8.6z',
  'swords': 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2',
  'timer': 'M10 2h4M12 14l3-3M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  'crown-fill': 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  'trophy': 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  'shield': 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  'video': 'M3.5 5.5h17v13h-17zM10 9v6l5-3z',
  'back': 'M19 12H5M11 6l-6 6 6 6',
  'chart': 'M4 20h16M6 20v-8h4v8M10 20V5h4v15M14 20v-6h4v6',
  'close': 'M6 6l12 12M18 6L6 18',
  'x-circle': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9l6 6M15 9l-6 6',
  'alert': 'M12 3.5L2.5 20h19zM12 10v4M12 17v.01',
  'sound': 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  'sound-off': 'M4 9v6h4l5 4V5L8 9zM17 9.5l5 5M22 9.5l-5 5',
  'vibrate': 'M8.5 4h7v16h-7zM5 8v8M19 8v8M2 10v4M22 10v4',
  'motion-off': 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM6.3 6.3l11.4 11.4',
  'gear': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  'check': 'M5 12.5l4.5 4.5L19 7',
  'id': 'M3.5 6h17v13h-17zM9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.8 17c.8-1.7 5.6-1.7 6.4 0M14.5 10h3.5M14.5 14h3.5',
} as const;
type IconName = keyof typeof ICONS;

function icon(name: IconName, cls = ''): SVGElement {
  const fill = name.endsWith('-fill');
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: `tw-icon ${cls}`.trim() });
  s.append(svg('path', fill
    ? { d: ICONS[name], fill: 'currentColor' }
    : { d: ICONS[name], fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
}

/** A small uppercase label row: text on the left, optional aside on the right. */
function labelRow(text: string, aside?: HTMLElement, forId?: string): HTMLElement {
  const row = el('div', 'tw-label-row');
  const l = el(forId ? 'label' : 'div', 'tw-label', text);
  if (forId) (l as HTMLLabelElement).htmlFor = forId;
  row.append(l);
  if (aside) row.append(aside);
  return row;
}

/** A stat tile (label over value) appended to `parent`; returns the label text and value elements. */
function statTile(parent: HTMLElement, name: IconName | null, label: string): { label: HTMLElement; value: HTMLElement } {
  const box = el('div', 'tw-tile');
  const l = el('div', 'tw-tile-label');
  const text = el('span', undefined, label);
  if (name) l.append(icon(name));
  l.append(text);
  const value = el('div', 'tw-tile-value tw-num');
  box.append(l, value);
  parent.append(box);
  return { label: text, value };
}

type RowEls = { root: HTMLElement; rank: HTMLElement; swatch: HTMLElement; name: HTMLElement; pct: HTMLElement; key: string };

export function createScreens(root: HTMLElement): Screens {
  root.classList.add('tw-ui');

  // ----- shared settings -----
  let reducedPref = readFlag(REDUCED_MOTION_KEY, false);
  const motionQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduceMotion = () => reducedPref || !!motionQuery?.matches;
  const applyReduced = () => root.classList.toggle('tw-reduced-motion', reducedPref);
  applyReduced();

  type Toggle = { btn: HTMLButtonElement; sync(): void };
  const toggles: Toggle[] = [];
  const syncAll = () => { for (const t of toggles) t.sync(); };
  /** In-game speaker toggle; stays in sync with the Sound setting. */
  const muteButton = (cls: string) => {
    const b = button(`tw-mute ${cls}`);
    b.addEventListener('click', () => {
      unlockAudio();
      setMuted(!isMuted());
      syncAll();
      playTick();
    });
    toggles.push({
      btn: b,
      sync() {
        const m = isMuted();
        b.replaceChildren(icon(m ? 'sound-off' : 'sound'));
        b.setAttribute('aria-label', m ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
        b.setAttribute('aria-pressed', String(m));
      },
    });
    return b;
  };

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
  nameField.append(icon('id', 'tw-field-icon'), nameInput);
  startCard.append(labelRow('Your name', el('span', 'tw-label-aside', `max ${NAME_MAX} chars`), 'tw-name'), nameField);

  const colorName = el('span', 'tw-label-aside tw-color-name');
  const swatches = el('div', 'tw-swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', 'Colour');
  const swatchBtns = PALETTE.players.map((c, i) => {
    const b = button('tw-swatch');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', COLOR_NAMES[i] ?? `Colour ${i + 1}`);
    const dot = el('span', 'tw-swatch-dot');
    dot.style.setProperty('--c', c.base);
    dot.style.setProperty('--lip', c.lip);
    dot.append(icon('check', 'tw-swatch-check'));
    b.append(dot);
    swatches.append(b);
    return b;
  });
  startCard.append(labelRow('Colour', colorName), swatches);

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
  const recordsBtn = button('tw-btn tw-btn-secondary tw-records-btn');
  recordsBtn.append(icon('chart'), el('span', undefined, 'Records'));
  recordsBtn.setAttribute('aria-label', 'Records and settings');
  startWrap.append(startCard, recordsBtn);
  start.append(startWrap);

  let chosen = 0;
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
  let onRecordsCb: ((p: StartPrefs) => void) | null = null;
  const pick = (i: number) => {
    chosen = i;
    swatchBtns.forEach((b, j) => {
      b.setAttribute('aria-checked', String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    const c = PALETTE.players[i];
    setText(colorName, COLOR_NAMES[i] ?? '');
    playBtn.style.setProperty('--btn', c.base);
    playBtn.style.setProperty('--btn-lip', c.lip);
  };
  swatchBtns.forEach((b, i) => b.addEventListener('click', () => { unlockAudio(); playTick(); pick(i); }));
  swatches.addEventListener('keydown', (e) => {
    const d = arrowStep(e);
    if (!d) return;
    e.preventDefault();
    const n = swatchBtns.length;
    const i = (chosen + d + n) % n;
    pick(i);
    swatchBtns[i].focus();
  });
  const currentPrefs = (): StartPrefs => ({ name: cleanName(nameInput.value), color: chosen, difficulty: chosenDiff });
  const submit = () => {
    if (!onPlayCb) return;
    const cb = onPlayCb;
    onPlayCb = onRecordsCb = null; // one click = one game
    cb(currentPrefs());
  };
  playBtn.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  recordsBtn.addEventListener('click', () => {
    if (!onRecordsCb) return;
    const cb = onRecordsCb;
    onPlayCb = onRecordsCb = null;
    unlockAudio();
    playTick();
    cb(currentPrefs());
  });

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

  const settingsList = el('div', 'tw-settings');
  const settingRow = (name: IconName, label: string, get: () => boolean, set: (on: boolean) => void) => {
    const b = button('tw-setting');
    b.setAttribute('role', 'switch');
    const knob = el('span', 'tw-switch');
    knob.setAttribute('aria-hidden', 'true');
    b.append(icon(name), el('span', 'tw-setting-label', label), knob);
    b.addEventListener('click', () => { set(!get()); syncAll(); });
    toggles.push({ btn: b, sync: () => b.setAttribute('aria-checked', String(get())) });
    settingsList.append(b);
  };
  settingRow('sound', 'Sound effects', () => !isMuted(), (on) => { unlockAudio(); setMuted(!on); playTick(); });
  settingRow('vibrate', 'Vibration', isVibrationOn, (on) => setVibrationOn(on));
  settingRow('motion-off', 'Reduced motion', () => reducedPref, (on) => {
    reducedPref = on;
    writeFlag(REDUCED_MOTION_KEY, on);
    applyReduced();
  });
  const recFoot = el('footer', 'tw-records-foot');
  recFoot.append(el('div', 'tw-foot-strong', 'Territory Wars · Ages 13+'), el('div', undefined, 'No in-app purchases'));
  recInner.append(recHead, sectionHead('trophy', 'Personal bests'), bestList, sectionHead('gear', 'Settings'), settingsList, recFoot);
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
  burnTag.append(icon('alert'), el('span', undefined, 'Burning'));
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
  const burnPill = el('div', 'tw-burn-pill');
  burnPill.append(icon('flame'), el('span', undefined, 'Your trail is burning — get home!'), icon('flame'));
  burnPill.hidden = true;
  alerts.append(burnPill);
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
  hud.append(area, boardBox, alerts, shieldToast, steerHint, minimapWrap, muteButton('tw-mute-hud'));
  let hudColor = -1;

  // ----- game over -----
  const over = el('div', 'tw-screen tw-over');
  const overCard = el('div', 'tw-card tw-over-card');
  const overDiff = el('div', 'tw-diff-chip');
  const overTitle = el('h2', 'tw-over-title');
  const newBestEl = el('div', 'tw-new-best');
  newBestEl.append(icon('star'), el('span', undefined, 'New best!'));
  const overBig = el('div', 'tw-over-big');
  const overPct = el('div', 'tw-over-pct tw-num');
  overBig.append(overPct, el('div', 'tw-over-pct-label', 'Territory owned'));
  const overStats = el('div', 'tw-tiles');
  const overKills = statTile(overStats, 'swords', 'Kills').value;
  const overTime = statTile(overStats, 'timer', 'Survived').value;
  const overBest = statTile(overStats, null, 'Best');
  const againBtn = button('tw-btn tw-again');
  againBtn.append(icon('play-fill'), el('span', undefined, 'Play again'));
  const homeBtn = button('tw-btn tw-btn-secondary tw-home', 'Home');
  overCard.append(overDiff, overTitle, newBestEl, overBig, overStats, againBtn, homeBtn);
  over.append(overCard);
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
  reviveCaption.append(document.createTextNode(`Keep 100% of your territory · ${CONFIG.REVIVE_PROTECT_S}s shield`));
  const noThanks = button('tw-link', 'No thanks, view results');
  reviveCard.append(closeBtn, pill, reviveTitle, reviveSub, ring, reviveStats, reviveBtn, reviveCaption, noThanks);
  if (!isNative) reviveCard.append(el('p', 'tw-keys-hint', 'Enter to revive · Esc to skip'));
  revive.append(reviveCard);
  revive.hidden = true;

  // One offer at a time: `offer` is null once it is settled (revived or given up).
  let offer: { handlers: ReviveHandlers; remaining: number; deadline: number; pending: boolean } | null = null;
  let reviveFrame: number | null = null;
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

  root.append(hud, start, records, over, revive);
  const all = [start, records, hud, over];
  const only = (shown: HTMLElement) => {
    for (const e of all) e.hidden = e !== shown;
    if (offer) closeRevive();
  };
  syncAll();
  only(start);

  return {
    minimap,
    showStart(prefs, bestFor, onPlay, onRecords) {
      bestForCb = bestFor;
      pickDiff(prefs.difficulty);
      nameInput.value = prefs.name;
      pick(((prefs.color % swatchBtns.length) + swatchBtns.length) % swatchBtns.length);
      onPlayCb = onPlay;
      onRecordsCb = onRecords;
      only(start);
      swatchBtns[chosen].scrollIntoView?.({ block: 'nearest', inline: 'center' });
      start.scrollTop = 0;
      playBtn.focus({ preventScroll: true });
    },
    showRecords(bestFor, onBack) {
      const bests: Partial<Record<Difficulty, BestScore | null>> = {};
      for (const d of DIFFICULTIES) bests[d] = bestFor(d);
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
      syncAll();
      onBackCb = onBack;
      only(records);
      records.scrollTop = 0;
      backBtn.focus({ preventScroll: true });
    },
    showHud() {
      for (const r of rowEls) { r.root.hidden = true; r.key = ''; }
      pctTween.snap(0);
      setText(pctNum, '0.00');
      setText(killsNum, '0');
      setText(timeNum, '0:00');
      burnPill.hidden = shieldToast.hidden = burnTag.hidden = true;
      area.classList.remove('tw-burning');
      steerHint.classList.remove('tw-gone');
      hudColor = -1;
      syncAll();
      only(hud);
    },
    tickHud(now) {
      setText(pctNum, Math.max(0, pctTween.value(now)).toFixed(2));
      return pctTween.active(now);
    },
    updateHud(world, now) {
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
      burnPill.hidden = burnTag.hidden = !a.burning;
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
    showOver(s, onAgain, onHome) {
      newBestEl.hidden = !s.newBest;
      setText(overTitle, s.won ? 'You won!' : 'Game over');
      setText(overDiff, DIFFICULTY_LABEL[s.difficulty]);
      overDiff.dataset.difficulty = s.difficulty;
      over.classList.toggle('tw-won', s.won);
      setText(overPct, formatPct(s.pct, 2));
      setText(overKills, String(s.kills));
      setText(overTime, formatTime(s.time));
      setText(overBest.label, `Best · ${DIFFICULTY_SHORT[s.difficulty]}`);
      setText(overBest.value, s.best ? formatPct(s.best.pct, 1) : '—');
      onAgainCb = onAgain;
      onHomeCb = onHome;
      only(over);
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
