/**
 * A skin is a player's whole look: its colour (an index into PALETTE.players) and the
 * face drawn on its head. Colours are never picked separately; each skin owns one.
 * A face is plain data (eyes, mouth, brows, extras), so a skin's look and how it
 * reacts to each mood can be tuned here without touching the renderer.
 */

/** How a head feels right now (see moods.ts for what triggers each). */
export type Mood = 'idle' | 'happy' | 'fierce' | 'scared' | 'ko';
export const MOODS: readonly Mood[] = ['idle', 'happy', 'fierce', 'scared', 'ko'];

export type EyeStyle =
  | 'dot'       // two small dots
  | 'round'     // big white eyes with pupils that look where the head is going
  | 'sleepy'    // half-closed lids
  | 'happy'     // ^ ^ arcs
  | 'wide'      // big white eyes, tiny pupils (scared)
  | 'x'         // knocked out
  | 'shades'    // sunglasses
  | 'cyclops'   // one big eye
  | 'star'      // star-shaped eyes
  | 'square';   // robot eyes
export type MouthStyle = 'none' | 'smile' | 'grin' | 'flat' | 'o' | 'frown' | 'fang' | 'cat' | 'wobble';
export type BrowStyle = 'none' | 'angry' | 'worried';
export type Extra = 'blush' | 'ears' | 'whiskers' | 'antenna' | 'sweat' | 'crown' | 'horns' | 'tear';

export type Face = { eyes: EyeStyle; mouth: MouthStyle; brows: BrowStyle; extras: readonly Extra[] };

export type AchievementId = 'kills10' | 'roundKills5' | 'pct25' | 'win' | 'revives3';

export type Unlock =
  | { kind: 'free' }
  /** Watch one rewarded ad (free in a browser). */
  | { kind: 'ad' }
  | { kind: 'achievement'; id: AchievementId };

export type Skin = {
  id: string;
  name: string;
  /** Palette index (PALETTE.players); unique per skin. */
  color: number;
  face: Face;
  /** Face parts this skin keeps in every mood (e.g. sunglasses stay on). */
  keep?: readonly (keyof Face)[];
  /** Skin-specific tweaks per mood, applied after the shared mood changes. */
  moods?: Partial<Record<Mood, Partial<Face>>>;
  unlock: Unlock;
};

/** Shared mood changes, applied over any skin's base face (minus what the skin keeps). */
export const MOOD_FACE: Record<Mood, Partial<Face>> = {
  idle: {},
  happy: { eyes: 'happy', mouth: 'grin' },
  fierce: { brows: 'angry', mouth: 'fang' },
  scared: { eyes: 'wide', mouth: 'wobble', brows: 'worried', extras: ['sweat'] },
  ko: { eyes: 'x', mouth: 'o', brows: 'none' },
};

const face = (f: Partial<Face> & Pick<Face, 'eyes' | 'mouth'>): Face => ({ brows: 'none', extras: [], ...f });

export const SKINS: readonly Skin[] = [
  { id: 'classic', color: 8, name: 'Classic', face: face({ eyes: 'dot', mouth: 'smile', extras: ['blush'] }), unlock: { kind: 'free' } },
  { id: 'grumpy', color: 1, name: 'Grumpy', face: face({ eyes: 'dot', mouth: 'frown', brows: 'angry' }), unlock: { kind: 'free' },
    moods: { happy: { mouth: 'flat' } } },
  { id: 'sleepy', color: 9, name: 'Sleepy', face: face({ eyes: 'sleepy', mouth: 'o' }), unlock: { kind: 'free' } },
  { id: 'cool', color: 7, name: 'Cool', face: face({ eyes: 'shades', mouth: 'grin' }), keep: ['eyes'], unlock: { kind: 'ad' } },
  { id: 'kitty', color: 12, name: 'Kitty', face: face({ eyes: 'round', mouth: 'cat', extras: ['ears', 'whiskers', 'blush'] }),
    unlock: { kind: 'ad' } },
  { id: 'bot', color: 6, name: 'Bot', face: face({ eyes: 'square', mouth: 'flat', extras: ['antenna'] }), keep: ['eyes'],
    unlock: { kind: 'ad' } },
  { id: 'cyclops', color: 4, name: 'Cyclops', face: face({ eyes: 'cyclops', mouth: 'grin' }), keep: ['eyes'],
    unlock: { kind: 'achievement', id: 'kills10' } },
  { id: 'devil', color: 0, name: 'Imp', face: face({ eyes: 'dot', mouth: 'fang', brows: 'angry', extras: ['horns'] }),
    unlock: { kind: 'achievement', id: 'roundKills5' } },
  { id: 'star', color: 2, name: 'Starry', face: face({ eyes: 'star', mouth: 'smile', extras: ['blush'] }),
    unlock: { kind: 'achievement', id: 'pct25' } },
  { id: 'phoenix', color: 5, name: 'Comeback', face: face({ eyes: 'round', mouth: 'grin', extras: ['tear'] }),
    moods: { idle: { mouth: 'smile' } }, unlock: { kind: 'achievement', id: 'revives3' } },
  { id: 'royal', color: 10, name: 'Royal', face: face({ eyes: 'dot', mouth: 'smile', extras: ['crown', 'blush'] }),
    unlock: { kind: 'achievement', id: 'win' } },
];

export const DEFAULT_SKIN = 'classic';

export function skinById(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/**
 * The face a skin shows in a mood: its base face, then the shared mood changes (except
 * the parts the skin keeps), then its own per-mood tweaks. Mood extras add to the skin's.
 */
export function faceFor(skin: Skin, mood: Mood): Face {
  const shared: Partial<Face> = { ...MOOD_FACE[mood] };
  for (const k of skin.keep ?? []) delete shared[k];
  const own = skin.moods?.[mood] ?? {};
  const extras = [...skin.face.extras, ...(shared.extras ?? []), ...(own.extras ?? [])];
  return { ...skin.face, ...shared, ...own, extras: [...new Set(extras)] };
}

/** The skin that owns palette colour `color`, if any. */
export function skinForColor(color: number): Skin | undefined {
  return SKINS.find((s) => s.color === color);
}

/**
 * A bot's look. Bots get distinct colours from the world (never the human's), so a bot
 * wears the skin of its colour; a colour no skin owns gets a face picked by id and seed.
 */
export function botSkin(playerId: number, colorIndex: number, seed: number): Skin {
  const own = skinForColor(colorIndex);
  if (own) return own;
  const h = Math.imul((playerId + 1) ^ seed, 2654435761) >>> 0;
  return { ...SKINS[h % SKINS.length], color: colorIndex };
}
