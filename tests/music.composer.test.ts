import { describe, it, expect } from 'vitest';
import { DANGER_SHOW } from '../src/game/danger';
import {
  DECAY_PER_BAR, FULL_AT, MELODY_AT, createComposer, layersFor, tierFor, type Composer, type NoteEv, type Tier,
} from '../src/game/music/composer';
import {
  BARS_PER_PHRASE, BPM, PROGRESSIONS, STEPS_PER_BAR, TENSE_PROGRESSIONS, chordSemis, createRng, stepSeconds,
} from '../src/game/music/theory';

const sorted = (s: Set<string>) => [...s].sort();

/** Bars `from` … `from + n - 1` of `c` at a fixed tier. */
function bars(c: Composer, tier: Tier, from: number, n: number): NoteEv[][] {
  c.setMood({ tier, danger: tier === 2 ? 0.6 : 0 });
  const out: NoteEv[][] = [];
  for (let i = from; i < from + n; i++) out.push(c.bar(i));
  return out;
}

/** One bar's notes relative to its first step, as a comparable string. */
const serialize = (notes: NoteEv[], index: number) =>
  notes.map((n) => `${n.layer}:${n.step - index * STEPS_PER_BAR}:${n.semi}:${n.dur}:${n.vel.toFixed(3)}`).join(',');

describe('music theory', () => {
  it('rng_is_seeded', () => {
    const a = createRng(7), b = createRng(7), c = createRng(8);
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });

  it('timing_constants', () => {
    expect(BPM).toEqual({ easy: 108, normal: 112, hard: 120 });
    expect(STEPS_PER_BAR).toBe(16);
    expect(BARS_PER_PHRASE).toBe(4);
    expect(stepSeconds(120)).toBeCloseTo(0.125);
  });

  it('progressions_are_four_chord_scale_degrees', () => {
    expect(PROGRESSIONS.length).toBeGreaterThanOrEqual(6);
    expect(TENSE_PROGRESSIONS.length).toBeGreaterThanOrEqual(3);
    for (const p of [...PROGRESSIONS, ...TENSE_PROGRESSIONS]) {
      expect(p.length).toBe(4);
      for (const d of p) expect(d >= 1 && d <= 7).toBe(true);
    }
    // Tense progressions lean on vi.
    for (const p of TENSE_PROGRESSIONS) expect(p[0]).toBe(6);
  });

  it('chord_semis_are_c_major_triads', () => {
    expect(chordSemis(1)).toEqual([-9, -5, -2]); // C E G
    expect(chordSemis(4)).toEqual([-4, 0, 3]); // F A C
    expect(chordSemis(5)).toEqual([-2, 2, 5]); // G B D
    expect(chordSemis(6)).toEqual([0, 3, 7]); // A C E
  });
});

describe('music composer', () => {
  it('tier_for_maps_states', () => {
    expect(tierFor(false, 0.9, false)).toBe(0);
    expect(tierFor(true, 0.1, false)).toBe(1);
    expect(tierFor(true, DANGER_SHOW, false)).toBe(2);
    expect(tierFor(false, 0, true)).toBe(3);
    expect(tierFor(true, 1, true)).toBe(3);
  });

  it('layers_for_calm_has_no_lead_or_drums', () => {
    expect(sorted(layersFor(0, 0))).toEqual(['pad', 'pluck']);
  });

  it('layers_for_burning_is_drums_and_root', () => {
    const l = layersFor(3, 1);
    for (const x of ['pad', 'pluck', 'lead'] as const) expect(l.has(x)).toBe(false);
    for (const x of ['kick', 'hat', 'bass'] as const) expect(l.has(x)).toBe(true);
  });

  it('layers_for_tiers_and_excitement', () => {
    expect(sorted(layersFor(1, 0))).toEqual(['bass', 'hat', 'pad', 'pluck']);
    expect(sorted(layersFor(2, 0))).toEqual(['bass', 'clap', 'hat', 'pad', 'pluck']);
    expect(sorted(layersFor(0, MELODY_AT))).toEqual(['clap', 'kick', 'lead', 'pad', 'pluck']);
    expect(layersFor(0, MELODY_AT).has('stab')).toBe(false);
    expect(layersFor(1, FULL_AT).has('stab')).toBe(true);
    expect(layersFor(3, FULL_AT).has('clap')).toBe(false);
  });

  it('bar_notes_stay_in_bar', () => {
    const c = createComposer({ seed: 3 });
    for (let i = 0; i < 64; i++) {
      c.setMood({ tier: (i >> 3) % 4 as Tier, danger: 0.5 });
      for (const n of c.bar(i)) {
        expect(n.step).toBeGreaterThanOrEqual(i * 16);
        expect(n.step).toBeLessThanOrEqual(i * 16 + 15);
        expect(n.vel).toBeGreaterThan(0);
        expect(n.vel).toBeLessThanOrEqual(1);
        expect(n.dur).toBeGreaterThan(0);
      }
    }
  });

  it('same_seed_same_music', () => {
    const a = bars(createComposer({ seed: 11 }), 1, 0, 16);
    const b = bars(createComposer({ seed: 11 }), 1, 0, 16);
    expect(a).toEqual(b);
  });

  it('different_seed_differs', () => {
    const a = bars(createComposer({ seed: 11 }), 1, 0, 16);
    const b = bars(createComposer({ seed: 12 }), 1, 0, 16);
    expect(a).not.toEqual(b);
  });

  it('no_repeat_over_five_minutes', () => {
    const c = createComposer({ seed: 5 });
    const moods: Tier[] = [0, 1, 2, 1, 0];
    const keys: string[] = [];
    moods.forEach((tier, block) => {
      bars(c, tier, block * 30, 30).forEach((notes, j) => keys.push(serialize(notes, block * 30 + j)));
    });
    expect(keys.length).toBe(150);
    const seen = new Set<string>();
    for (let i = 0; i + 8 <= keys.length; i++) {
      const w = keys.slice(i, i + 8).join('|');
      expect(seen.has(w)).toBe(false);
      seen.add(w);
    }
  });

  it('calm_bass_free_and_low_density', () => {
    for (const seed of [1, 2, 3]) {
      for (const notes of bars(createComposer({ seed }), 0, 0, 40)) {
        for (const n of notes) expect(['bass', 'kick', 'lead']).not.toContain(n.layer);
        expect(notes.length).toBeLessThanOrEqual(12);
        expect(notes.length).toBeGreaterThan(0);
      }
    }
  });

  it('voices_stay_in_phone_friendly_ranges', () => {
    const c = createComposer({ seed: 9 });
    for (let i = 0; i < 48; i++) {
      c.setMood({ tier: (i >> 2) % 4 as Tier, danger: 0.5 });
      for (const n of c.bar(i)) {
        if (n.layer === 'bass') expect(n.semi).toBeGreaterThanOrEqual(-24);
        if (n.layer === 'pad' || n.layer === 'pluck') {
          expect(n.semi).toBeGreaterThanOrEqual(-12);
          expect(n.semi).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  it('progression_changes_every_phrase', () => {
    const c = createComposer({ seed: 4 });
    const roots: number[] = [];
    for (const notes of bars(c, 1, 0, 32)) roots.push(Math.min(...notes.filter((n) => n.layer === 'bass').map((n) => n.semi)));
    for (let p = 1; p < 8; p++) {
      const prev = roots.slice((p - 1) * 4, p * 4).join(), cur = roots.slice(p * 4, p * 4 + 4).join();
      expect(cur).not.toBe(prev);
    }
  });

  it('danger_pulses_root_eighths_without_kick', () => {
    const c = createComposer({ seed: 6 });
    for (const [j, notes] of bars(c, 2, 0, 8).entries()) {
      expect(notes.some((n) => n.layer === 'kick')).toBe(false);
      const bass = notes.filter((n) => n.layer === 'bass');
      expect(bass.map((n) => n.step - j * 16)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
      expect(new Set(bass.map((n) => n.semi)).size).toBe(1);
    }
  });

  it('excitement_brings_lead_from_chord_tones_and_decays', () => {
    const c = createComposer({ seed: 2, excitement: 1 });
    c.setMood({ tier: 1, danger: 0 });
    expect(c.excitement).toBe(1);
    const first = c.bar(0);
    expect(c.excitement).toBeCloseTo(1 - DECAY_PER_BAR);
    const lead = first.filter((n) => n.layer === 'lead');
    expect(lead.length).toBeGreaterThan(0);
    expect(first.some((n) => n.layer === 'stab')).toBe(true);
    const pcs = new Set(first.filter((n) => n.layer === 'pad' || n.layer === 'stab').map((n) => ((n.semi % 12) + 12) % 12));
    for (const n of lead) expect(pcs.has(((n.semi % 12) + 12) % 12)).toBe(true);
    for (let i = 1; i < 8; i++) c.bar(i);
    expect(c.excitement).toBe(0);
    expect(c.bar(8).some((n) => n.layer === 'lead')).toBe(false);
  });
});
