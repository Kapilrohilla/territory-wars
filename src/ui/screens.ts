import { PALETTE } from '../game/palette';
import { pct } from '../sim/world';
import type { World } from '../sim/types';

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

export const NAME_MAX = 14;
export const DEFAULT_NAME = 'You';

export function cleanName(raw: string): string {
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return n || DEFAULT_NAME;
}

// ---------- DOM ----------

export type StartPrefs = { name: string; color: number };
export type OverStats = { won: boolean; pct: number; kills: number; time: number };

export type Screens = {
  showStart(prefs: StartPrefs, onPlay: (prefs: StartPrefs) => void): void;
  showHud(): void;
  /** Refreshes the HUD; returns true while the % counter is animating (call tickHud per frame). */
  updateHud(world: World, now: number): boolean;
  /** Advances the % counter animation; returns true while it is still animating. */
  tickHud(now: number): boolean;
  showOver(stats: OverStats, onAgain: () => void): void;
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

type RowEls = { root: HTMLElement; rank: HTMLElement; swatch: HTMLElement; name: HTMLElement; pct: HTMLElement; key: string };

export function createScreens(root: HTMLElement): Screens {
  root.classList.add('tw-ui');

  // ----- start -----
  const start = el('div', 'tw-screen tw-start');
  const startCard = el('div', 'tw-card');
  startCard.append(el('h1', 'tw-title', 'Territory Wars'));
  startCard.append(el('p', 'tw-tagline', 'Loop out, come home, claim the map.'));
  const nameLabel = el('label', 'tw-label', 'Your name');
  const nameInput = el('input', 'tw-input');
  nameInput.type = 'text';
  nameInput.maxLength = NAME_MAX;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.id = 'tw-name';
  nameLabel.htmlFor = 'tw-name';
  const colorLabel = el('div', 'tw-label', 'Colour');
  const swatches = el('div', 'tw-swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', 'Colour');
  const swatchBtns = PALETTE.players.map((c, i) => {
    const b = el('button', 'tw-swatch');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Colour ${i + 1}`);
    const dot = el('span', 'tw-swatch-dot');
    dot.style.background = c.base;
    dot.style.boxShadow = `0 3px 0 ${c.lip}`;
    b.append(dot);
    swatches.append(b);
    return b;
  });
  const playBtn = el('button', 'tw-btn tw-play', 'Play');
  playBtn.type = 'button';
  const hint = el('p', 'tw-hint',
    'Drag anywhere (or use arrow keys / WASD) to steer. Leave your land and loop back to claim the area. ' +
    'Cross a rival’s trail to knock them out — but guard your own.');
  startCard.append(nameLabel, nameInput, colorLabel, swatches, playBtn, hint);
  start.append(startCard);

  let chosen = 0;
  let onPlayCb: ((p: StartPrefs) => void) | null = null;
  const pick = (i: number) => {
    chosen = i;
    swatchBtns.forEach((b, j) => {
      b.setAttribute('aria-checked', String(j === i));
      b.tabIndex = j === i ? 0 : -1;
    });
    const c = PALETTE.players[i];
    playBtn.style.background = c.base;
    playBtn.style.boxShadow = `0 4px 0 ${c.lip}`;
  };
  swatchBtns.forEach((b, i) => b.addEventListener('click', () => pick(i)));
  swatches.addEventListener('keydown', (e) => {
    const n = swatchBtns.length;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') d = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') d = -1;
    if (!d) return;
    e.preventDefault();
    const i = (chosen + d + n) % n;
    pick(i);
    swatchBtns[i].focus();
  });
  const submit = () => {
    if (!onPlayCb) return;
    const cb = onPlayCb;
    onPlayCb = null; // one click = one game
    cb({ name: cleanName(nameInput.value), color: chosen });
  };
  playBtn.addEventListener('click', submit);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  // ----- HUD -----
  const hud = el('div', 'tw-hud');
  const stats = el('div', 'tw-stats');
  const pctEl = el('div', 'tw-pct', '0.00%');
  const killsEl = el('div', 'tw-kills', 'Kills 0');
  stats.append(pctEl, killsEl);
  const board = el('ol', 'tw-board');
  board.setAttribute('aria-label', 'Leaderboard');
  const pctTween = createPctTween(300);
  const rowEls: RowEls[] = [];
  for (let i = 0; i < 6; i++) {
    const r = el('li', 'tw-row');
    const rank = el('span', 'tw-rank');
    const swatch = el('span', 'tw-row-swatch');
    const name = el('span', 'tw-row-name');
    const p = el('span', 'tw-row-pct');
    r.append(rank, swatch, name, p);
    r.hidden = true;
    board.append(r);
    rowEls.push({ root: r, rank, swatch, name, pct: p, key: '' });
  }
  hud.append(stats, board);

  // ----- game over -----
  const over = el('div', 'tw-screen tw-over');
  const overCard = el('div', 'tw-card');
  const overTitle = el('h2', 'tw-over-title');
  const overStats = el('div', 'tw-over-stats');
  const stat = (label: string) => {
    const box = el('div', 'tw-stat');
    const v = el('div', 'tw-stat-value');
    box.append(v, el('div', 'tw-stat-label', label));
    overStats.append(box);
    return v;
  };
  const overPct = stat('Territory');
  const overKills = stat('Kills');
  const overTime = stat('Survived');
  const againBtn = el('button', 'tw-btn tw-again', 'Play again');
  againBtn.type = 'button';
  overCard.append(overTitle, overStats, againBtn);
  over.append(overCard);
  let onAgainCb: (() => void) | null = null;
  againBtn.addEventListener('click', () => {
    const cb = onAgainCb;
    onAgainCb = null;
    cb?.();
  });

  root.append(hud, start, over);
  const all = [start, hud, over];
  const only = (shown: HTMLElement) => { for (const e of all) e.hidden = e !== shown; };
  only(start);

  return {
    showStart(prefs, onPlay) {
      nameInput.value = prefs.name;
      pick(((prefs.color % swatchBtns.length) + swatchBtns.length) % swatchBtns.length);
      onPlayCb = onPlay;
      only(start);
      playBtn.focus({ preventScroll: true });
    },
    showHud() {
      for (const r of rowEls) { r.root.hidden = true; r.key = ''; }
      pctTween.snap(0);
      setText(pctEl, '0.00%');
      setText(killsEl, 'Kills 0');
      only(hud);
    },
    tickHud(now) {
      setText(pctEl, formatPct(pctTween.value(now), 2));
      return pctTween.active(now);
    },
    updateHud(world, now) {
      const human = world.players[world.humanId];
      pctTween.set(pct(world, human.id), now);
      setText(pctEl, formatPct(pctTween.value(now), 2));
      setText(killsEl, `Kills ${human.kills}`);
      const rows = buildLeaderboard(boardEntries(world));
      rowEls.forEach((r, i) => {
        const row = rows[i];
        if (!row) { r.root.hidden = true; return; }
        r.root.hidden = false;
        setText(r.rank, row.leader ? '★' : `${row.rank}.`);
        setText(r.name, row.name);
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
    showOver(s, onAgain) {
      setText(overTitle, s.won ? 'You won!' : 'Game over');
      over.classList.toggle('tw-won', s.won);
      setText(overPct, formatPct(s.pct, 2));
      setText(overKills, String(s.kills));
      setText(overTime, formatTime(s.time));
      onAgainCb = onAgain;
      only(over);
      againBtn.focus({ preventScroll: true });
    },
  };
}
