/** One mulberry32 step: returns the next value in [0,1) and the new state. */
export function mulberryNext(state: number): { value: number; state: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: a };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    const r = mulberryNext(a);
    a = r.state;
    return r.value;
  };
}
