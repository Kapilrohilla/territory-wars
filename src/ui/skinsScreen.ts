import { drawFace, drawFaceBack, type FaceColors } from '../game/faces';
import { faceFor, MOODS, SKINS, skinById, type Mood, type Skin } from '../game/skins';
import { button, el, icon, setText } from './dom';
import { ACHIEVEMENTS, isUnlocked, type Lifetime } from './progress';

export type SkinsView = {
  /** The player's colour, so previews match their block. */
  colors: FaceColors;
  /** Equipped skin id. */
  selected: string;
  lifetime: Lifetime;
  adUnlocks: ReadonlySet<string>;
  /** In the app an ad unlock costs a rewarded ad; in a browser it is free. */
  native: boolean;
  /** Equips an unlocked skin. */
  select(id: string): void;
  /** Unlocks an ad skin; resolves true once unlocked. */
  unlockWithAd(id: string): Promise<boolean>;
};

const MOOD_LABEL: Record<Mood, string> = { idle: 'Idle', happy: 'Happy', fierce: 'Fierce', scared: 'Scared', ko: 'KO' };

/** One skin's state on the grid, from the view: equipped, usable, ad-unlockable or locked. */
export type SkinState = 'equipped' | 'unlocked' | 'ad' | 'locked';

export function skinState(skin: Skin, view: Pick<SkinsView, 'selected' | 'lifetime' | 'adUnlocks'>): SkinState {
  if (isUnlocked(skin, view.lifetime, view.adUnlocks)) return skin.id === view.selected ? 'equipped' : 'unlocked';
  return skin.unlock.kind === 'ad' ? 'ad' : 'locked';
}

/** Paints a block head with `skin`'s face in `mood` onto a square canvas of `cssSize` px. */
export function paintSkin(canvas: HTMLCanvasElement, skin: Skin, mood: Mood, colors: FaceColors, cssSize: number): void {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const px = Math.round(cssSize * dpr);
  if (canvas.width !== px) canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  // Head of size u, with room above for ears/crowns and below for the side face.
  const u = px * 0.6;
  const side = u * 0.16;
  ctx.translate(px / 2, px / 2 + u * 0.08);
  const face = faceFor(skin, mood);
  drawFaceBack(ctx, face, u, colors);
  const r = u * 0.25;
  const square = (dy: number) => {
    ctx.beginPath();
    ctx.roundRect(-u / 2, -u / 2 + dy, u, u, r);
  };
  square(side);
  ctx.fillStyle = colors.lip;
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fill();
  square(0);
  ctx.fillStyle = colors.lip;
  ctx.fill();
  drawFace(ctx, face, u, { x: 0, y: 0.4 });
}

export function createSkinsScreen(onBack: () => void): { root: HTMLElement; show(view: SkinsView): void; focus(): void } {
  const root = el('div', 'tw-screen tw-page tw-skins');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-labelledby', 'tw-skins-title');
  const inner = el('div', 'tw-page-inner');
  const head = el('header', 'tw-page-head');
  const backBtn = button('tw-icon-btn tw-back');
  backBtn.setAttribute('aria-label', 'Back to home');
  backBtn.append(icon('back'));
  backBtn.addEventListener('click', onBack);
  const titles = el('div', 'tw-page-titles');
  const title = el('h2', 'tw-page-title', 'Skins');
  title.id = 'tw-skins-title';
  titles.append(title, el('div', 'tw-page-sub', 'Faces for your block'));
  head.append(backBtn, titles);

  // Big preview of one skin, with mood chips to see how its face reacts in play.
  const hero = el('section', 'tw-skin-hero');
  const heroCanvas = el('canvas', 'tw-skin-hero-canvas');
  heroCanvas.setAttribute('role', 'img');
  const heroText = el('div', 'tw-skin-hero-text');
  const heroName = el('div', 'tw-skin-hero-name');
  const heroNote = el('div', 'tw-skin-hero-note');
  const moodGroup = el('div', 'tw-moods');
  moodGroup.setAttribute('role', 'radiogroup');
  moodGroup.setAttribute('aria-label', 'Preview mood');
  const moodBtns = MOODS.map((m) => {
    const b = button('tw-mood', MOOD_LABEL[m]);
    b.setAttribute('role', 'radio');
    moodGroup.append(b);
    return b;
  });
  heroText.append(heroName, heroNote, moodGroup);
  hero.append(heroCanvas, heroText);

  const note = el('p', 'tw-skins-note');
  note.append(icon('lock'), el('span', undefined, 'No purchases: unlock skins by playing, or with a short ad'));
  const grid = el('div', 'tw-skin-grid');
  inner.append(head, hero, note, grid);
  root.append(inner);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); onBack(); } });

  let view: SkinsView | null = null;
  let previewId = SKINS[0].id;
  let mood: Mood = 'idle';
  let busy = false;

  const paintHero = () => {
    if (!view) return;
    const s = skinById(previewId);
    paintSkin(heroCanvas, s, mood, view.colors, 112);
    heroCanvas.setAttribute('aria-label', `${s.name} skin, ${MOOD_LABEL[mood].toLowerCase()} face`);
    setText(heroName, s.name);
    const st = skinState(s, view);
    setText(heroNote, st === 'equipped' ? 'Equipped' : st === 'unlocked' ? 'Unlocked'
      : st === 'ad' ? 'Unlock with a short ad'
      : s.unlock.kind === 'achievement' ? `Locked: ${ACHIEVEMENTS[s.unlock.id].label}` : 'Locked');
    moodBtns.forEach((b, i) => {
      const on = MOODS[i] === mood;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  const pickMood = (m: Mood) => { mood = m; paintHero(); };
  moodBtns.forEach((b, i) => b.addEventListener('click', () => pickMood(MOODS[i])));
  moodGroup.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = (MOODS.indexOf(mood) + d + MOODS.length) % MOODS.length;
    pickMood(MOODS[i]);
    moodBtns[i].focus();
  });

  const render = () => {
    if (!view) return;
    const v = view;
    grid.replaceChildren(...SKINS.map((s) => {
      const st = skinState(s, v);
      const card = el('article', `tw-skin-card tw-skin-${st}`);
      card.setAttribute('aria-label', `${s.name}: ${st === 'equipped' ? 'equipped' : st === 'unlocked' ? 'unlocked' : 'locked'}`);
      if (st === 'equipped') card.append(el('div', 'tw-skin-ribbon', 'Equipped'));
      if (st === 'ad' && v.native) card.append(el('span', 'tw-ad-tag tw-skin-adtag', 'AD'));
      const face = button('tw-skin-face');
      face.setAttribute('aria-label', `Preview ${s.name}`);
      face.setAttribute('aria-pressed', String(s.id === previewId));
      const c = el('canvas');
      paintSkin(c, s, 'idle', v.colors, 72);
      face.append(c);
      if (st === 'locked') face.append(icon('lock', 'tw-skin-lock'));
      face.addEventListener('click', () => { previewId = s.id; render(); });
      card.append(face, el('div', 'tw-skin-name', s.name));
      if (st === 'locked' && s.unlock.kind === 'achievement') {
        const a = ACHIEVEMENTS[s.unlock.id];
        card.append(el('div', 'tw-skin-goal', a.label), el('div', 'tw-skin-progress tw-num', a.progress(v.lifetime)));
      }
      const action = button(`tw-skin-btn tw-skin-btn-${st}`);
      if (st === 'equipped') {
        action.textContent = 'Active';
        action.disabled = true;
      } else if (st === 'unlocked') {
        action.textContent = 'Use';
        action.setAttribute('aria-label', `Use ${s.name}`);
        action.addEventListener('click', () => { v.select(s.id); previewId = s.id; view = { ...v, selected: s.id }; render(); });
      } else if (st === 'ad') {
        if (v.native) action.append(icon('video'));
        action.append(el('span', undefined, v.native ? 'Watch ad' : 'Unlock'));
        action.setAttribute('aria-label', v.native ? `Watch an ad to unlock ${s.name}` : `Unlock ${s.name}`);
        action.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          action.disabled = true;
          let ok = false;
          try { ok = await v.unlockWithAd(s.id); } catch { ok = false; }
          busy = false;
          if (!view) return;
          if (ok) {
            const ad = new Set(view.adUnlocks).add(s.id);
            view.select(s.id);
            view = { ...view, adUnlocks: ad, selected: s.id };
            previewId = s.id;
          }
          render();
        });
      } else {
        action.textContent = 'Locked';
        action.disabled = true;
      }
      card.append(action);
      return card;
    }));
    paintHero();
  };

  return {
    root,
    show(v) {
      view = v;
      previewId = v.selected;
      mood = 'idle';
      render();
      root.scrollTop = 0;
    },
    focus() { backBtn.focus({ preventScroll: true }); },
  };
}
