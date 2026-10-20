export type PlayerColors = { base: string; lip: string; trail: string };

export type Palette = {
  bg: string;
  arena: string;
  grid: string;
  players: PlayerColors[];
};

/** 13 pastel hues, spread around the wheel for distinctness. */
const HUES = [355, 22, 44, 78, 122, 156, 180, 200, 222, 248, 272, 298, 326];

export const PALETTE: Palette = {
  bg: '#e4e2dc',
  arena: '#f8f7f3',
  grid: 'rgba(60, 60, 80, 0.06)',
  players: HUES.map((h) => ({
    base: `hsl(${h}, 72%, 74%)`,
    lip: `hsl(${h}, 42%, 57%)`,
    trail: `hsla(${h}, 80%, 80%, 0.6)`,
  })),
};
