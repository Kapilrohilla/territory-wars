export type PlayerColors = { base: string; lip: string; trail: string };

export type Palette = {
  bg: string;
  arena: string;
  grid: string;
  players: PlayerColors[];
};

/** 13 pastel hues, spread around the wheel for distinctness. */
const HUES = [355, 22, 44, 78, 122, 156, 180, 200, 222, 248, 272, 298, 326];

/** Display names for the hues above, in the same order (home screen colour picker). */
export const COLOR_NAMES = [
  'Rose', 'Coral', 'Amber', 'Lime', 'Green', 'Jade', 'Teal',
  'Sky', 'Periwinkle', 'Iris', 'Violet', 'Orchid', 'Pink',
];

/**
 * A player's colour between its lip (k = 0, the darker shade) and its base (k = 1), for
 * land that brightens as it is captured or darkens as it dies.
 */
export function playerShade(colorIndex: number, k: number): string {
  const n = HUES.length;
  const h = HUES[((colorIndex % n) + n) % n];
  const u = k < 0 ? 0 : k > 1 ? 1 : k;
  return `hsl(${h}, ${(45 + 33 * u).toFixed(1)}%, ${(54 + 16 * u).toFixed(1)}%)`;
}

export const PALETTE: Palette = {
  bg: '#e4e2dc',
  arena: '#f8f7f3',
  grid: 'rgba(60, 60, 80, 0.06)',
  players: HUES.map((h) => ({
    base: `hsl(${h}, 78%, 70%)`,
    lip: `hsl(${h}, 45%, 54%)`,
    trail: `hsla(${h}, 80%, 80%, 0.6)`,
  })),
};
