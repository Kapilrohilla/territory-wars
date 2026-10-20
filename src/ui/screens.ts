import { PALETTE } from '../game/palette';
import { pct } from '../sim/world';
import { DIFFICULTIES, type Difficulty } from '../sim/config';
import type { DeathCause, World } from '../sim/types';
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

// ---------- DOM ----------

export type StartPrefs = { name: string; color: number; difficulty: Difficulty };
export type OverStats = {
  won: boolean; pct: number; kills: number; time: number; newBest: boolean; difficulty: Difficulty;
};

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

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
  /** Home screen: best score (for the selected difficulty), name, colour, difficulty and Play. */
  showStart(
    prefs: StartPrefs,
    bestFor: (difficulty: Difficulty) => BestScore | null,
    onPlay: (prefs: StartPrefs) => void,
  ): void;
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

type RowEls = { root: HTMLElement; rank: HTMLElement; swatch: HTMLElement; name: HTMLElement; pct: HTMLElement; key: string };

export function createScreens(root: HTMLElement): Screens {
  root.classList.add('tw-ui');

  // ----- start -----
  const start = el('div', 'tw-screen tw-start');
  const startCard = el('div', 'tw-card');
  startCard.append(el('h1', 'tw-title', 'Territory Wars'));
  startCard.append(el('p', 'tw-tagline', 'Loop out, come home, claim the map.'));
  const bestBox = el('div', 'tw-best');
  const bestLabel = el('div', 'tw-best-label', 'Best score');
  const bestPct = el('div', 'tw-best-pct');
  const bestMeta = el('div', 'tw-best-meta');
  bestBox.append(bestLabel, bestPct, bestMeta);
  startCard.append(bestBox);
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
  const diffLabel = el('div', 'tw-label', 'Difficulty');
  const diffGroup = el('div', 'tw-segments');
  diffGroup.setAttribute('role', 'radiogroup');
  diffGroup.setAttribute('aria-label', 'Difficulty');
  const diffBtns = DIFFICULTIES.map((d) => {
    const b = el('button', 'tw-segment', DIFFICULTY_LABEL[d]);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    diffGroup.append(b);
    return b;
  });
  startCard.append(playBtn, nameLabel, nameInput, colorLabel, swatches, diffLabel, diffGroup, hint);
  start.append(startCard);

  let chosen = 0;
  let chosenDiff: Difficulty = 'normal';
  let bestForCb: (d: Difficulty) => BestScore | null = () => null;
  const showBest = (best: BestScore | null) => {
    if (best) {
      setText(bestPct, formatPct(best.pct, 2));
      setText(bestMeta, `${best.kills} ${best.kills === 1 ? 'kill' : 'kills'} · ${formatTime(best.time)} survived`);
      bestBox.classList.remove('tw-best-empty');
    } else {
      setText(bestPct, '—');
      setText(bestMeta, 'No best yet. Go claim some land!');
      bestBox.classList.add('tw-best-empty');
    }
  };
  const pickDiff = (d: Difficulty) => {
    chosenDiff = d;
    diffBtns.forEach((b, j) => {
      const on = DIFFICULTIES[j] === d;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    setText(bestLabel, `Best score · ${DIFFICULTY_LABEL[d]}`);
    showBest(bestForCb(d));
  };
  diffBtns.forEach((b, i) => b.addEventListener('click', () => pickDiff(DIFFICULTIES[i])));
  diffGroup.addEventListener('keydown', (e) => {
    const n = diffBtns.length;
    let d = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') d = 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') d = -1;
    if (!d) return;
    e.preventDefault();
    const i = (DIFFICULTIES.indexOf(chosenDiff) + d + n) % n;
    pickDiff(DIFFICULTIES[i]);
    diffBtns[i].focus();
  });
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
    cb({ name: cleanName(nameInput.value), color: chosen, difficulty: chosenDiff });
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
  const minimap = el('canvas', 'tw-minimap');
  minimap.setAttribute('aria-label', 'Map of the whole arena');
  minimap.setAttribute('role', 'img');
  hud.append(stats, board, minimap);

  // ----- game over -----
  const over = el('div', 'tw-screen tw-over');
  const overCard = el('div', 'tw-card');
  const overTitle = el('h2', 'tw-over-title');
  const overDiff = el('div', 'tw-diff-tag');
  const newBestEl = el('div', 'tw-new-best', 'New best!');
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
  const homeBtn = el('button', 'tw-btn tw-home', 'Home');
  homeBtn.type = 'button';
  overCard.append(overTitle, overDiff, newBestEl, overStats, againBtn, homeBtn);
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
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = (tag: string, attrs: Record<string, string>) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const revive = el('div', 'tw-screen tw-revive');
  revive.setAttribute('role', 'dialog');
  revive.setAttribute('aria-modal', 'true');
  revive.setAttribute('aria-labelledby', 'tw-revive-title');
  const reviveCard = el('div', 'tw-card tw-revive-card');
  const closeBtn = el('button', 'tw-revive-close', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close and view results');
  const pill = el('div', 'tw-ko-pill');
  pill.append(el('span', 'tw-ko-icon', '!'), document.createTextNode('Knocked out!'));
  const reviveTitle = el('h2', 'tw-revive-title', 'Knocked out!');
  reviveTitle.id = 'tw-revive-title';
  const reviveSub = el('p', 'tw-revive-sub');
  const ring = el('div', 'tw-ring');
  ring.setAttribute('role', 'timer');
  const RING_R = 44;
  const RING_C = 2 * Math.PI * RING_R;
  const ringSvg = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  ringSvg.append(svg('circle', { class: 'tw-ring-track', cx: '50', cy: '50', r: String(RING_R) }));
  const ringArc = svg('circle', {
    class: 'tw-ring-arc', cx: '50', cy: '50', r: String(RING_R),
    'stroke-dasharray': RING_C.toFixed(2), transform: 'rotate(-90 50 50)',
  });
  ringSvg.append(ringArc);
  const ringNum = el('div', 'tw-ring-num', '5');
  ring.append(ringSvg, ringNum, el('div', 'tw-ring-sec', 'SEC'));
  const reviveStats = el('div', 'tw-revive-stats');
  const rstat = (label: string) => {
    const box = el('div', 'tw-revive-stat');
    const v = el('div', 'tw-revive-stat-value');
    const l = el('div', 'tw-revive-stat-label', label);
    box.append(l, v);
    reviveStats.append(box);
    return { label: l, value: v };
  };
  const rBest = rstat('Best');
  const rKills = rstat('Kills').value;
  const rTime = rstat('Time').value;
  const reviveBtn = el('button', 'tw-btn tw-revive-btn');
  reviveBtn.type = 'button';
  const reviveIcon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'tw-revive-icon' });
  reviveIcon.append(svg('path', {
    d: 'M12 21s-7.5-4.6-9.3-9.2C1.4 8.4 3.6 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 16.4 12 21 12 21z',
  }));
  reviveBtn.append(reviveIcon, document.createTextNode('Revive'));
  const reviveCaption = el('p', 'tw-revive-caption', 'Keep 100% of your territory · once per round');
  const noThanks = el('button', 'tw-link', 'No thanks, view results');
  noThanks.type = 'button';
  reviveCard.append(closeBtn, pill, reviveTitle, reviveSub, ring, reviveStats, reviveBtn, reviveCaption, noThanks);
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

  root.append(hud, start, over, revive);
  const all = [start, hud, over];
  const only = (shown: HTMLElement) => {
    for (const e of all) e.hidden = e !== shown;
    if (offer) closeRevive();
  };
  only(start);

  return {
    minimap,
    showStart(prefs, bestFor, onPlay) {
      bestForCb = bestFor;
      pickDiff(prefs.difficulty);
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
    showOver(s, onAgain, onHome) {
      newBestEl.hidden = !s.newBest;
      setText(overTitle, s.won ? 'You won!' : 'Game over');
      setText(overDiff, DIFFICULTY_LABEL[s.difficulty]);
      overDiff.dataset.difficulty = s.difficulty;
      over.classList.toggle('tw-won', s.won);
      setText(overPct, formatPct(s.pct, 2));
      setText(overKills, String(s.kills));
      setText(overTime, formatTime(s.time));
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
      setText(rBest.label, `Best · ${DIFFICULTY_LABEL[info.difficulty]}`);
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
