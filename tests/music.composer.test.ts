import { describe, it, expect } from 'vitest';
import { DANGER_SHOW } from '../src/game/danger';
import {
  BOOST, DECAY_PER_BAR, FULL_AT, MELODY_AT, createComposer, layersFor, quantize, tierFor,
  type Composer, type MusicEvent, type NoteEv, type Tier,
} from '../src/game/music/composer';
import {
  BARS_PER_PHRASE, BPM, PROGRESSIONS, STEPS_PER_BAR, TENSE_PROGRESSIONS, chordSemis, createRng, scaleSemi, stepSeconds,
} from '../src/game/music/theory';

const sorted = (s: Set<string>) => [...s].sort();

/** Bars `from` … `from + n - 1` of `c` at a fixed tier. */
function bars(c: Composer, tier: Tier, from: number, n: number): NoteEv[][] {
  c.setMood({ tier, danger: tier === 2 ? 0.6 : 0 });
  const out: NoteEv[][] = [];
  for (let i = from; i < from + n; i++) out.push(c.bar(i));
  return out;
}

/** One bar's audible content relative to its first step, as a comparable string. */
const serialize = (notes: NoteEv[], index: number) =>
  notes.map((n) => `${n.layer}:${n.step - index * STEPS_PER_BAR}:${n.semi}:${n.dur}`).join(',');

const pc = (semi: number) => ((semi % 12) + 12) % 12;
const has = (notes: NoteEv[], layer: string) => notes.some((n) => n.layer === layer);

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
    // Toms, not a kick: the burning heartbeat isn't tempo-locked and a kick would beat against it.
    for (const ex of [0, 1]) {
      expect(sorted(layersFor(3, ex))).toEqual(['bass', 'clap', 'fill', 'hat']);
    }
  });

  it('burning_drives_on_toms_claps_and_hats_with_the_root_in_the_bass', () => {
    const c = createComposer({ seed: 12 });
    for (const [i, notes] of bars(c, 3, 0, 8).entries()) {
      expect(has(notes, 'kick')).toBe(false);
      const toms = notes.filter((n) => n.layer === 'fill');
      expect(toms.length).toBeGreaterThanOrEqual(4);
      // Even in the lowest round key the toms' body (half the note, see VOICES.fill) stays ≥ 150 Hz.
      for (const n of toms) expect((440 * 2 ** ((n.semi - 3) / 12)) / 2).toBeGreaterThanOrEqual(150);
      expect(notes.filter((n) => n.layer === 'clap').map((n) => n.step - i * STEPS_PER_BAR)).toEqual([4, 12]);
      expect(has(notes, 'hat')).toBe(true);
      const bass = notes.filter((n) => n.layer === 'bass');
      expect(bass.length).toBeGreaterThan(0);
      expect(new Set(bass.map((n) => n.semi)).size).toBe(1);
    }
  });

  it('layers_for_tiers_and_excitement', () => {
    expect(sorted(layersFor(1, 0))).toEqual(['bass', 'hat', 'pad', 'pluck']);
    expect(sorted(layersFor(2, 0))).toEqual(['bass', 'clap', 'hat', 'pad', 'pluck']);
    expect(sorted(layersFor(0, MELODY_AT))).toEqual(['clap', 'kick', 'lead', 'pad', 'pluck']);
    expect(layersFor(0, MELODY_AT).has('stab')).toBe(false);
    expect(layersFor(1, FULL_AT).has('stab')).toBe(true);
    for (const x of ['kick', 'lead', 'stab'] as const) expect(layersFor(3, FULL_AT).has(x)).toBe(false);
  });

  it('excited_danger_adds_clap_but_no_kick', () => {
    // The danger heartbeat isn't tempo-locked, so a kick would beat against it.
    const l = layersFor(2, 1);
    expect(l.has('kick')).toBe(false);
    for (const x of ['clap', 'lead', 'stab'] as const) expect(l.has(x)).toBe(true);
    const c = createComposer({ seed: 8 });
    c.events([{ e: 'steal', size: 3 }], 0);
    for (const notes of bars(c, 2, 1, 6)) expect(has(notes, 'kick')).toBe(false);
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

  it('voices_stay_in_phone_friendly_ranges_bass_under_pad', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = createComposer({ seed });
      for (let i = 0; i < 48; i++) {
        c.setMood({ tier: (i >> 2) % 3 as Tier, danger: 0.5 });
        for (const n of c.bar(i)) if (n.layer === 'bass') expect(n.semi).toBeLessThanOrEqual(-9);
      }
    }
  });

  it('pluck_passing_tones_are_short', () => {
    let judged = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = createComposer({ seed });
      for (let i = 0; i < 40; i++) {
        const notes = c.bar(i);
        const pad = new Set(notes.filter((n) => n.layer === 'pad').map((n) => pc(n.semi)));
        // The chord is the one diatonic triad holding every pad tone (skip bars where that's ambiguous).
        const fits = [1, 2, 3, 4, 5, 6, 7].map((d) => new Set(chordSemis(d).map(pc))).filter((t) => [...pad].every((x) => t.has(x)));
        if (fits.length !== 1) continue;
        for (const n of notes.filter((x) => x.layer === 'pluck')) {
          if (fits[0].has(pc(n.semi))) continue;
          judged++;
          expect(n.dur).toBeLessThanOrEqual(2);
        }
      }
    }
    expect(judged).toBeGreaterThan(0);
  });

  it('excitement_brings_hummable_lead_and_decays', () => {
    const c = createComposer({ seed: 2 });
    c.setMood({ tier: 1, danger: 0 });
    c.bar(0);
    expect(c.excitement).toBe(0);
    c.events([{ e: 'steal', size: 0.5 }], 8);
    expect(c.excitement).toBe(1);
    let steps = 0, moves = 0;
    for (let i = 1; i <= 2; i++) {
      const notes = c.bar(i);
      const lead = notes.filter((n) => n.layer === 'lead' && n.vel > 0.5);
      const pcs = new Set(notes.filter((n) => n.layer === 'stab').map((n) => pc(n.semi)));
      expect(pcs.size).toBe(3);
      // Strong beats land on chord tones.
      for (const n of lead) if (n.step % 4 === 0) expect(pcs.has(pc(n.semi))).toBe(true);
      for (let j = 1; j < lead.length; j++) {
        const d = Math.abs(lead[j].semi - lead[j - 1].semi);
        moves++;
        if (d <= 2) steps++;
      }
    }
    expect(moves).toBeGreaterThan(0);
    expect(steps / moves).toBeGreaterThanOrEqual(0.4);
    for (let i = 3; i < 10; i++) c.bar(i);
    expect(c.excitement).toBe(0);
    expect(has(c.bar(10), 'lead')).toBe(false);
  });

  it('lead_mixes_passing_tones_mostly_by_step', () => {
    let passing = 0, steps = 0, moves = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const c = createComposer({ seed });
      c.setMood({ tier: 1, danger: 0 });
      for (let i = 0; i < 12; i++) {
        if (i % 3 === 0) c.events([{ e: 'capture' }], i * 16 - 16);
        const notes = c.bar(i);
        const lead = notes.filter((n) => n.layer === 'lead' && n.vel > 0.5 && n.step >= i * 16); // melody, not the counter line
        const root = notes.filter((n) => n.layer === 'bass').map((n) => n.semi)[0];
        if (root === undefined) continue;
        const pad = new Set(notes.filter((n) => n.layer === 'pad').map((n) => pc(n.semi)));
        for (const n of lead) if (!pad.has(pc(n.semi))) passing++;
        for (let j = 1; j < lead.length; j++) {
          moves++;
          if (Math.abs(lead[j].semi - lead[j - 1].semi) <= 2) steps++;
        }
      }
    }
    expect(passing).toBeGreaterThan(0);
    expect(steps / moves).toBeGreaterThan(0.5);
  });

  it('lead_register_capped', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const c = createComposer({ seed });
      c.setMood({ tier: 1, danger: 0 });
      for (let i = 0; i < 24; i++) {
        if (i % 4 === 0) {
          const big = i % 8 === 0;
          const riff = c.events([{ e: 'steal', size: big ? 4 : 1 }], i * 16 - 8).filter((n) => n.layer === 'lead');
          const last = riff[riff.length - 1];
          for (const n of riff) expect(n.semi).toBeLessThanOrEqual(n === last && big ? 24 : 19);
        }
        for (const n of c.bar(i)) if (n.layer === 'lead') expect(n.semi).toBeLessThanOrEqual(19);
      }
    }
  });
});

describe('music composer events', () => {
  it('boosts_rank_steal_over_capture_over_escape', () => {
    expect(BOOST).toEqual({ steal: 1, capture: 0.6, kill: 0.6, escape: 0.35, overtake: 0.35 });
  });

  it('quantize_next_eighth', () => {
    expect(quantize(5)).toBe(6);
    expect(quantize(6)).toBe(6);
    expect(quantize(6.2)).toBe(6);
    expect(quantize(7.9)).toBe(8);
    expect(quantize(0)).toBe(0);
    expect(quantize(6.25)).toBe(6);
    expect(quantize(6.3)).toBe(8);
  });

  /** Bars after an event at step 8 of bar 0, with bar 0 already returned. */
  function after(list: { e: MusicEvent; size?: number }[], n: number, seed = 1): { riff: NoteEv[]; bars: NoteEv[][] } {
    const c = createComposer({ seed });
    c.setMood({ tier: 1, danger: 0 });
    c.bar(0);
    const riff = c.events(list, 8);
    const out: NoteEv[][] = [];
    for (let i = 1; i <= n; i++) out.push(c.bar(i));
    return { riff, bars: out };
  }

  it('steal_is_biggest_lift', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const steal = after([{ e: 'steal', size: 1 }], 3, seed);
      for (const notes of steal.bars) {
        expect(has(notes, 'lead')).toBe(true);
        expect(has(notes, 'stab')).toBe(true);
      }
      const capture = after([{ e: 'capture' }], 8, seed);
      expect(capture.bars.filter((b) => has(b, 'lead')).length).toBeLessThanOrEqual(2);
      for (const b of capture.bars) expect(has(b, 'stab')).toBe(false);
      const escape = after([{ e: 'escape' }], 8, seed);
      for (const b of escape.bars) expect(has(b, 'lead')).toBe(false);
    }
  });

  it('stinger_shapes', () => {
    const small = after([{ e: 'steal', size: 1 }], 0).riff;
    const big = after([{ e: 'steal', size: 3 }], 0).riff;
    const smallLead = small.filter((n) => n.layer === 'lead'), bigLead = big.filter((n) => n.layer === 'lead');
    expect(smallLead.length).toBeGreaterThanOrEqual(5);
    expect(bigLead.length).toBeGreaterThan(smallLead.length);
    expect(bigLead.length).toBeLessThanOrEqual(7);
    // Ends on a stab chord, after the riff; the big riff's last note jumps an octave.
    for (const r of [small, big]) {
      const lastLead = Math.max(...r.filter((n) => n.layer === 'lead').map((n) => n.step));
      const stabs = r.filter((n) => n.layer === 'stab');
      expect(stabs.length).toBe(3);
      for (const s of stabs) expect(s.step).toBeGreaterThan(lastLead);
      expect(Math.max(...r.map((n) => n.step))).toBeLessThan(8 + 2 + 16);
    }
    expect(bigLead[bigLead.length - 1].semi).toBe(smallLead[smallLead.length - 1].semi + 12);

    const cap = after([{ e: 'capture' }], 0).riff;
    expect(cap.map((n) => n.layer)).toEqual(['pluck', 'pluck', 'pluck']);
    expect(cap[1].semi).toBeGreaterThan(cap[0].semi);
    expect(cap[2].semi).toBeGreaterThan(cap[1].semi);

    for (const e of ['escape', 'overtake'] as const) {
      const r = after([{ e }], 0).riff;
      expect(r.map((n) => n.layer)).toEqual(['pluck', 'pluck']);
      expect(r[1].semi).toBeGreaterThan(r[0].semi);
    }

    const kill = after([{ e: 'kill', size: 1 }], 0).riff;
    const kill3 = after([{ e: 'kill', size: 3 }], 0).riff;
    for (const r of [kill, kill3]) {
      for (const n of r) expect(n.layer).toBe('fill');
      expect(Math.max(...r.map((n) => n.step + n.dur)) - r[0].step).toBeLessThanOrEqual(4);
    }
    expect(kill3[kill3.length - 1].semi).toBe(kill[kill.length - 1].semi + 4); // two more in the streak
    expect(kill3.slice(0, -1)).toEqual(kill.slice(0, -1));
  });

  it('bigger_steal_holds_longer', () => {
    const stabBars = (size: number) => after([{ e: 'steal', size }], 10).bars.filter((b) => has(b, 'stab')).length;
    expect(stabBars(5)).toBeGreaterThan(stabBars(0.5));
    expect(stabBars(0.5)).toBe(2);
    expect(stabBars(5)).toBe(6);
  });

  it('same_step_events_merge_to_strongest', () => {
    const c = createComposer({ seed: 3 });
    c.setMood({ tier: 1, danger: 0 });
    c.bar(0);
    const out = c.events([{ e: 'capture' }, { e: 'kill' }, { e: 'steal' }, { e: 'milestone' }], 4);
    expect(out.length).toBeGreaterThan(0);
    for (const n of out) expect(['lead', 'stab']).toContain(n.layer);
    expect(c.excitement).toBe(1);
    // The lift waits for the next bar so it never clashes with the one still ringing.
    expect(c.keyOffset).toBe(0);
    c.bar(1);
    expect(c.keyOffset).toBe(1);
  });

  it('weaker_event_never_lowers_excitement', () => {
    const c = createComposer({ seed: 3 });
    c.events([{ e: 'steal' }], 0);
    c.events([{ e: 'escape' }], 2);
    expect(c.excitement).toBe(1);
  });

  it('stingers_quantized', () => {
    const events: MusicEvent[] = ['steal', 'capture', 'kill', 'escape', 'overtake', 'win', 'gameover'];
    for (const e of events) {
      for (const now of [5, 6.2, 7.9, 33.4]) {
        const c = createComposer({ seed: 4 });
        c.bar(0);
        const out = c.events([{ e, size: 2 }], now);
        expect(out.length).toBeGreaterThan(0);
        for (const n of out) expect(n.step).toBeGreaterThanOrEqual(quantize(now));
        expect(Math.min(...out.map((n) => n.step)) % 2).toBe(0);
      }
    }
  });

  it('key_offset_caps_at_3', () => {
    const c = createComposer({ seed: 1 });
    expect(c.keyOffset).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect(c.events([{ e: 'milestone' }], i * 16)).toEqual([]);
      c.bar(i);
    }
    expect(c.keyOffset).toBe(3);
  });

  it('key_lift_waits_for_the_next_bar', () => {
    // keyOffset is the offset of the most recently composed bar; a milestone lifts the next one.
    const c = createComposer({ seed: 1 });
    c.bar(0);
    c.events([{ e: 'milestone' }], 4);
    expect(c.keyOffset).toBe(0);
    c.bar(1);
    expect(c.keyOffset).toBe(1);
    c.bar(2);
    expect(c.keyOffset).toBe(1);
  });

  it('two_milestones_before_a_bar_lift_it_twice_up_to_the_cap', () => {
    const c = createComposer({ seed: 1 });
    c.bar(0);
    c.events([{ e: 'milestone' }], 2);
    c.events([{ e: 'milestone' }], 4);
    c.bar(1);
    expect(c.keyOffset).toBe(2);
    for (let i = 0; i < 3; i++) c.events([{ e: 'milestone' }], 20 + 2 * i);
    c.bar(2);
    expect(c.keyOffset).toBe(3);
  });

  it('a_lift_pending_at_the_end_never_applies', () => {
    // The closing cadence spans two bars and must stay in one key.
    const c = createComposer({ seed: 1 });
    c.bar(0);
    c.events([{ e: 'milestone' }, { e: 'win' }], 4);
    c.bar(1);
    c.bar(2);
    expect(c.keyOffset).toBe(0);
  });

  it('stingers_fit_the_bar_they_land_in', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = createComposer({ seed });
      c.setMood({ tier: 0, danger: 0 });
      const padPcs = (notes: NoteEv[]) => new Set(notes.filter((n) => n.layer === 'pad').map((n) => pc(n.semi)));
      // The player composes a bar ahead: bars 0 and 1 are both known while bar 0 plays.
      const b0 = padPcs(c.bar(0)), b1 = padPcs(c.bar(1));
      const arp = (now: number) => new Set(c.events([{ e: 'capture' }], now).map((n) => pc(n.semi)));
      const fits = (chord: Set<number>, notes: Set<number>) => [...chord].every((x) => notes.has(x));
      expect(fits(b0, arp(4))).toBe(true); // lands in bar 0
      expect(fits(b1, arp(15.9))).toBe(true); // quantizes to step 16: bar 1
      expect(fits(b1, arp(40))).toBe(true); // bar 2 not composed yet: latest known chord
    }
  });

  it('down_silences_until_revive', () => {
    const c = createComposer({ seed: 5 });
    c.setMood({ tier: 1, danger: 0 });
    c.events([{ e: 'steal', size: 2 }], 0);
    expect(c.state).toBe('playing');
    expect(c.events([{ e: 'down' }], 4)).toEqual([]);
    expect(c.state).toBe('down');
    for (let i = 0; i < 3; i++) expect(c.bar(i)).toEqual([]);
    for (const e of ['steal', 'capture', 'kill', 'escape', 'milestone'] as const) {
      expect(c.events([{ e }], 40)).toEqual([]);
    }
    expect(c.keyOffset).toBe(0);
    expect(c.events([{ e: 'revive' }], 50)).toEqual([]);
    expect(c.state).toBe('playing');
    expect(c.excitement).toBe(0);
    const back = c.bar(4);
    expect(back.length).toBeGreaterThan(0);
    expect(has(back, 'lead')).toBe(false);
  });

  it('game_over_while_down_ends_silently', () => {
    const c = createComposer({ seed: 5 });
    c.events([{ e: 'down' }], 0);
    expect(c.events([{ e: 'gameover' }], 20)).toEqual([]);
    expect(c.state).toBe('ended');
    expect(c.events([{ e: 'revive' }], 30)).toEqual([]);
    expect(c.state).toBe('ended');
  });

  it('ending_plays_cadence_then_silence', () => {
    for (const e of ['win', 'gameover'] as const) {
      const c = createComposer({ seed: 6 });
      c.setMood({ tier: 1, danger: 0 });
      c.bar(0);
      const out = c.events([{ e }], 10);
      expect(c.state).toBe('ended');
      const q = quantize(10);
      for (const n of out) {
        expect(n.step).toBeGreaterThanOrEqual(q);
        expect(n.step + n.dur).toBeLessThanOrEqual(q + 32);
      }
      const pad = out.filter((n) => n.layer === 'pad');
      // I – V – I: chord changes at the half bar and at the second bar.
      expect([...new Set(pad.map((n) => n.step - q))]).toEqual([0, 8, 16]);
      const at = (s: number) => pad.filter((n) => n.step - q === s).map((n) => pc(n.semi)).sort((a, b) => a - b);
      expect(at(0)).toEqual(at(16));
      expect(at(8)).not.toEqual(at(0));
      expect(has(out, 'lead')).toBe(e === 'win');
      for (const n of out) expect(['pad', 'lead']).toContain(n.layer);
      expect(c.bar(1)).toEqual([]);
      expect(c.events([{ e: 'steal' }, { e: 'revive' }], 40)).toEqual([]);
      expect(c.state).toBe('ended');
    }
  });

  it('cadence_ends_on_the_tonic', () => {
    const c = createComposer({ seed: 6 });
    const out = c.events([{ e: 'win' }], 0);
    const lastPad = out.filter((n) => n.layer === 'pad' && n.step === 16).map((n) => pc(n.semi));
    expect(lastPad).toContain(pc(scaleSemi(0)));
    const lead = out.filter((n) => n.layer === 'lead');
    expect(pc(lead[lead.length - 1].semi)).toBe(pc(scaleSemi(0)));
  });

  it('mood_changes_apply_on_bar_boundary', () => {
    const c = createComposer({ seed: 7 });
    c.setMood({ tier: 0, danger: 0 });
    const first = c.bar(0);
    const copy = JSON.parse(JSON.stringify(first));
    c.setMood({ tier: 3, danger: 1 });
    expect(first).toEqual(copy);
    expect(has(first, 'pad')).toBe(true);
    const next = c.bar(1);
    expect(has(next, 'pad')).toBe(false);
    expect(has(next, 'fill')).toBe(true);
  });

  it('steal_while_burning_still_riffs_but_bars_stay_bare', () => {
    const c = createComposer({ seed: 9 });
    c.setMood({ tier: 3, danger: 1 });
    c.bar(0);
    expect(has(c.events([{ e: 'steal', size: 1 }], 8), 'lead')).toBe(true);
    for (let i = 1; i < 4; i++) {
      for (const n of c.bar(i)) expect(['fill', 'clap', 'hat', 'bass']).toContain(n.layer);
    }
  });
});
