# Adaptive Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Code-generated, never-repeating background music that stays soft while you're calm, tightens with danger, and turns catchy on exciting moments. Stealing land is the peak.

**Architecture:**
- A pure, seeded **composer** (`src/game/music/`) decides what to play bar by bar and which stingers to add. It reads a mood (tier and raw danger) and game events.
- A Web Audio **player** schedules the composer's notes ahead on the AudioContext clock through a music bus.
- `sound.ts` gains separate SFX and music buses under the shared master, plus a global transpose so the effects follow the music's key.
- The session feeds mood and events; the HUD feeds overtakes.

**Tech Stack:** TypeScript, Web Audio API, Vitest (mock AudioContext as in `tests/sound.test.ts`).

**Spec:** `docs/superpowers/specs/2026-10-24-adaptive-music-design.md`

## Global Constraints

- No audio files, samples or music libraries: everything is synthesized with Web Audio.
- `src/sim` is untouched. The music RNG is its own seeded generator in `src/game/music`, never the sim's `rngState`.
- Phone speakers: every music voice has its main energy at or above 150 Hz. Bass uses a triangle or saw plus a 2× partial; no sub-only voices.
- Music never masks gameplay cues:
  - music bus peak ≤ the SFX peak;
  - `MUSIC_GAIN = 0.5` at 100 % music volume;
  - the music ducks to 0.6× for 250 ms on capture, steal, kill, milestone and alert.
- Notes are scheduled on the AudioContext clock: look-ahead timer 25 ms, horizon 0.12 s. Never schedule from `requestAnimationFrame`.
- No leaks: every voice disconnects on `onended`; stop, pause and dispose clear the scheduler timer. A hidden tab already pauses the game (`main.ts` `visibilitychange`), and pause silences the music.
- Storage only via `src/ui/settings.ts` (`readRaw`/`writeRaw`, all inside try/catch). The music volume key is `territory-wars.musicVolume`, default `50`.
- Mute silences music and SFX together. Reduce motion doesn't affect music.
- Transpose range: the round key is one of `ROUND_KEYS = [-3, -2, -1, 0, 1]` semitones vs C. Each milestone adds +1, so the total is always within [-3, +4].
- Never commit `*.apk`, `image.png`, `image copy.png`, `.claude/`, `docs/mobile-designs/3d/` or `.superpowers/`. Never `git add -A`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- All content original.

## Review Focus

1. **A round that keeps going for 5+ minutes:** no identical 8-bar stretch, no runaway voice count, and steady memory (no growing arrays or timers). Owned by the Task 2 test `no_repeat_over_five_minutes` and the Task 4 test `scheduler_holds_no_backlog`.
2. **Events arriving while the music isn't playing:** pause, revive offer, after game over, before the first start, after dispose. These must schedule nothing and never throw. Owned by the Task 4 test `events_when_idle_are_ignored`.
3. **Several events in one step:** a steal plus capture plus kill plus milestone together give one combined lift, with the steal winning and no stacked stingers. Owned by the Task 3 test `same_step_events_merge_to_strongest`.
4. **No AudioContext** (blocked or unsupported, or audio not yet unlocked when the round starts): the music silently no-ops, and starts on the next scheduler tick once the context exists. Owned by the Task 4 test `starts_late_when_context_appears`.
5. **Rapid mood flicker** (danger hovering at the threshold, in and out of home every frame): layers change only on bar boundaries, and the lowpass glides rather than jumping. Owned by the Task 3 test `mood_changes_apply_on_bar_boundary`, plus a Task 4 player assertion that the filter uses `setTargetAtTime`.

---

### Task 1: Audio plumbing — buses, music volume, transpose, raw danger, settings UI

**Files:**
- Modify: `src/game/sound.ts` (master chain ~L55-130, `note` ~L325, `unlockAudio` ~L209)
- Modify: `src/ui/settings.ts`, `src/game/danger.ts` (~L147-171), `src/ui/screens.ts` (Sound & Feel ~L659-700, pause card ~L1247)
- Test: `tests/sound.test.ts`, `tests/storageBlocked.test.ts`, `tests/danger.test.ts` (or wherever `sampleDanger` is tested)

**Interfaces:**
- Produces (sound.ts):
  - `MUSIC_GAIN = 0.5`
  - `audioContext(): AudioContext | null`
  - `musicBus(): GainNode | null`
  - `getMusicVolume(): number` and `setMusicVolume(v: number): void` (0–100, saved)
  - `setTranspose(semis: number): void` (clamped to [-3, 4]) and `getTranspose(): number`
  - `duckMusic(): void`
- Produces (settings.ts): `MUSIC_VOLUME_KEY = 'territory-wars.musicVolume'`, `DEFAULT_MUSIC_VOLUME = 50`, `getMusicVolume(store?)`, `setMusicVolume(v, store?)`.
- Produces (danger.ts): `DangerState.raw: number`, which is `dangerLevel(world)` whatever the warnings setting.

- [ ] **Step 1: Write failing tests**
  - `master_level_excludes_sfx_volume`: `masterLevel()` is `MASTER_GAIN` when unmuted, `0` when muted, and doesn't change with `setVolume`.
  - `buses_split_under_master`: after `unlockAudio()` on the mock context, the links are sfx bus → master and music bus → master. The sfx bus gain is `volume/100` and the music bus gain is `MUSIC_GAIN × musicVolume/100`.
  - `music_volume_persists_and_defaults_50`: works with a mem store, and with a throwing store (in `storageBlocked.test.ts`).
  - `transpose_shifts_pitched_effects`: `setTranspose(2)` makes `playSound('capture', {pct: 0.5})`'s first oscillator frequency `note(3 + 2)`. `setTranspose(9)` clamps to 4.
  - `duck_music_dips_then_restores`: `duckMusic()` schedules the music bus gain to 0.6× its level, then back within 0.25 s.
  - `raw_danger_ignores_warnings_setting`: with `warnings: false`, `level === 0` but `raw === dangerLevel(world)`.

- [ ] **Step 2: Run them, expect FAIL** — `npx vitest run tests/sound.test.ts tests/danger.test.ts tests/storageBlocked.test.ts`

- [ ] **Step 3: Implement**
  - Split the chain: master (mute × `MASTER_GAIN`) → limiter → trim → destination, with an SFX bus and a music bus feeding master.
  - `play()` writes to the SFX bus, so `setVolume` drives only the SFX bus gain.
  - `note(semi)` adds the current transpose. Raw-Hz percussion (heartbeat knock, ticks, noise) stays untransposed.
  - `danger.ts` sets `s.raw` every sample.
  - Sound & Feel: add a "Music" slider row under the existing (now "Sound effects volume") slider, same markup. The input id is `tw-music-volume`; its preview plays one soft pluck through the music bus at most every `PREVIEW_TICK_MS`. Relabel both mute rows (home and pause cards) from "Sound effects" to "Sound".

- [ ] **Step 4: Run `npm test`, expect PASS.** Update existing tests that assumed `masterLevel() = MASTER_GAIN × volume`.

- [ ] **Step 5: Commit** — `feat: separate music and SFX buses, music volume, effect transpose, raw danger`

---

### Task 2: Music theory and the composer core (pure, seeded)

**Files:**
- Create: `src/game/music/theory.ts`, `src/game/music/composer.ts`
- Test: `tests/music.composer.test.ts`

**Interfaces:**
- Produces (theory.ts):
  - `type Rng = () => number` and `createRng(seed: number): Rng` (mulberry32)
  - `BPM: Record<Difficulty, number> = { easy: 108, normal: 112, hard: 120 }`
  - `STEPS_PER_BAR = 16`, `BARS_PER_PHRASE = 4`, `ROUND_KEYS = [-3, -2, -1, 0, 1]`
  - `stepSeconds(bpm: number): number` (one 16th)
  - `PROGRESSIONS: number[][]` (major-key scale-degree progressions, ≥ 6, each 4 chords) and `TENSE_PROGRESSIONS: number[][]` (≥ 3, minor-leaning, e.g. vi–IV–vi–V)
  - `chordSemis(degree: number): number[]`: triad tones as semitones above A4, in C major, before transpose. The player adds the key.
- Produces (composer.ts):
  ```ts
  export type Layer = 'pad' | 'pluck' | 'bass' | 'kick' | 'clap' | 'hat' | 'lead' | 'stab' | 'fill';
  export type NoteEv = { layer: Layer; step: number; semi: number; dur: number; vel: number };
  // step = absolute 16th index since start; semi = semitones vs A4 in C (player adds transpose); dur in steps; vel 0..1
  export type Tier = 0 | 1 | 2 | 3; // home, out, danger, burning
  export type MusicMood = { tier: Tier; danger: number }; // danger = raw 0..1
  export function tierFor(outside: boolean, dangerRaw: number, burning: boolean): Tier; // burning→3; outside && dangerRaw ≥ TENSION_MIN → 2; outside → 1; else 0
  export function layersFor(tier: Tier, excitement: number): Set<Layer>;
  export type Composer = {
    setMood(m: MusicMood): void;   // takes effect at the next bar()
    bar(index: number): NoteEv[];  // all notes for steps index*16 … index*16+15
    readonly excitement: number;
  };
  export function createComposer(opts: { seed: number }): Composer;
  ```
- `layersFor`, decided here (`MELODY_AT = 0.5`, `FULL_AT = 0.9`):

  | Tier | Layers |
  |---|---|
  | 0 | pad, pluck |
  | 1 | pad, pluck, bass, hat |
  | 2 | pad, bass (pulsing eighths on the root), hat, clap; pluck at half density; no kick (the heartbeat is the pulse) |
  | 3 | kick, hat, bass on the root only; no pad, pluck or lead |

  - excitement ≥ `MELODY_AT` adds lead, plus kick and clap if the tier is below 3.
  - excitement ≥ `FULL_AT` also adds stab, a fuller pluck and a counter line on lead.
- Variation:
  - Every phrase (4 bars), pick a progression different from the last, from `PROGRESSIONS`, or from `TENSE_PROGRESSIONS` when tier is 2.
  - Pluck and hat rhythms come from small template lists, re-picked per phrase and mutated per bar (drop or add one hit).
  - When lead turns on, generate a 1-bar motif from chord tones. Later bars vary it: transpose to the current chord, shift its rhythm, and invert it every other bar.
  - Instruments drift: per phrase, randomly skip at most one non-essential calm layer (pluck register or pad voicing).

- [ ] **Step 1: Write failing tests**
  - `tier_for_maps_states`: (false, 0.9, false) → 0; (true, 0.1, false) → 1; (true, TENSION_MIN, false) → 2; (anything, any, true) → 3.
  - `layers_for_calm_has_no_lead_or_drums`: `layersFor(0, 0)` is exactly {pad, pluck}.
  - `layers_for_burning_is_drums_and_root`: `layersFor(3, 1)` contains no pad, pluck or lead.
  - `bar_notes_stay_in_bar`: for 64 bars, every `NoteEv.step` is within [i·16, i·16+15] and `vel` is within (0, 1].
  - `same_seed_same_music` and `different_seed_differs`.
  - `no_repeat_over_five_minutes`: at 120 BPM, a bar is 2 s, so 150 bars ≈ 5 min. Run the moods home→out→danger→out→home in 30-bar blocks. Serialize each bar's notes relative to its first step. No 8 consecutive bars appear twice.
  - `calm_bass_free_and_low_density`: tier 0 bars have no bass, kick or lead, and ≤ 12 notes per bar.

- [ ] **Step 2: Run them, expect FAIL** — `npx vitest run tests/music.composer.test.ts`

- [ ] **Step 3: Implement `theory.ts` and `composer.ts`** to the interfaces above. Excitement starts at 0 here; Task 3 adds the boosts. `bar()` decays it by `DECAY_PER_BAR = 0.25`, floored at 0.

- [ ] **Step 4: Run, expect PASS**, then `npm test`.

- [ ] **Step 5: Commit** — `feat: seeded music composer with mood layers and phrase variation`

---

### Task 3: Composer events — stingers, excitement, key changes, down and ending

**Files:**
- Modify: `src/game/music/composer.ts`
- Test: `tests/music.composer.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces (adds to `Composer`):
  ```ts
  export type MusicEvent = 'steal' | 'capture' | 'kill' | 'escape' | 'overtake' | 'milestone' | 'down' | 'revive' | 'win' | 'gameover';
  export const BOOST = { steal: 1, capture: 0.6, kill: 0.6, escape: 0.35, overtake: 0.35 } as const;
  export function quantize(nowStep: number): number; // next 8th boundary (multiple of 2) ≥ nowStep; if nowStep is within 0.25 step past a boundary use that boundary
  events(list: { e: MusicEvent; size?: number }[], nowStep: number): NoteEv[]; // one call per sim step's cues; returns stinger notes, all with step ≥ quantize(nowStep)
  readonly keyOffset: number;  // 0..3: milestones passed, added on top of the round key
  readonly state: 'playing' | 'down' | 'ended';
  ```
- Rules:
  - **Merging:** within one `events()` call, take only the strongest boost (steal > capture = kill > escape = overtake).
    - Excitement becomes `max(current, boost)`.
    - A steal also holds excitement at ≥ `FULL_AT` for `2 + min(4, floor(size))` bars, where `size` is the stolen-capture `pct`, before decay resumes.
    - Return only that event's stinger.
  - **Stingers:**

    | Event | Stinger |
    |---|---|
    | steal | A bouncy 5–7 note "gotcha" riff on lead over 1 bar, ending on a `stab` chord. Longer and higher (extra notes, +12 on the last) when `size ≥ 2`. |
    | capture | A 3-note rising arpeggio on pluck, in the current chord. |
    | kill | A 1-beat `fill`; with streak via `size`, the last hit goes one step higher per streak. |
    | escape, overtake | A 2-note rising pluck. |

  - **milestone:** `keyOffset += 1` (max 3), applied from the next bar.
  - **down:** `state = 'down'`. `bar()` returns `[]`; `events()` returns `[]` except for `revive`.
  - **revive:** `state = 'playing'` and excitement 0.
  - **win / gameover:** return a 2-bar closing cadence (I–V–I on pad, plus lead on a win), then `state = 'ended'`, after which everything returns `[]`.
  - **Mood:** mood changes (`setMood`) take effect only at the next `bar()`.

- [ ] **Step 1: Write failing tests**
  - `quantize_next_eighth`: 5 → 6, 6 → 6, 6.2 → 6, 7.9 → 8.
  - `steal_is_biggest_lift`: after `events([{e:'steal', size:1}])`, the next 3 bars include `lead` and `stab`. After `capture`, lead appears for ≤ 2 bars and never `stab`. After `escape`, no lead.
  - `bigger_steal_holds_longer`: the number of bars with stab is greater for `size 5` than for `size 0.5`.
  - `same_step_events_merge_to_strongest`: `events([{e:'capture'},{e:'kill'},{e:'steal'},{e:'milestone'}])` returns the steal riff only (all lead or stab) and sets `keyOffset` to 1.
  - `stingers_quantized`: every returned note has `step ≥ quantize(now)` and `step % 2 === 0` for its first note.
  - `key_offset_caps_at_3`: four milestones give `keyOffset === 3`.
  - `down_silences_until_revive` and `ending_plays_cadence_then_silence`.
  - `mood_changes_apply_on_bar_boundary`: `setMood(tier 3)` between two `bar()` calls doesn't change notes already returned. The following bar has no pad.

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS**, then `npm test`.

- [ ] **Step 5: Commit** — `feat: music stingers, steal peak, milestone key lifts, down and ending`

---

### Task 4: Instruments and the look-ahead player

**Files:**
- Create: `src/game/music/instruments.ts`, `src/game/music/player.ts`
- Test: `tests/music.player.test.ts`

**Interfaces:**
- Consumes:
  - sound.ts `audioContext()`, `musicBus()`, `getTranspose()`, `MAX_GAIN`
  - Task 2/3 `createComposer`, `NoteEv`, `MusicMood`, `MusicEvent`, `stepSeconds`, `BPM`
- Produces:
  ```ts
  // instruments.ts — one function per Layer, writes a voice into `out` at time t (s), freq from semi
  export type Voice = (c: AudioContext, out: AudioNode, t: number, freq: number, durS: number, vel: number) => void;
  export const VOICES: Record<Layer, Voice>;
  // player.ts
  export type MusicPlayer = {
    start(): void; pause(): void; resume(): void; dispose(): void;
    setMood(m: MusicMood): void;
    events(list: { e: MusicEvent; size?: number }[]): void;
    readonly playing: boolean;
  };
  export function createMusicPlayer(opts: {
    difficulty: Difficulty; seed: number;
    ctx?: () => AudioContext | null; bus?: () => AudioNode | null;  // default: sound.ts audioContext/musicBus
    timers?: { set(fn: () => void, ms: number): number; clear(id: number): void }; // default window.setTimeout
  }): MusicPlayer;
  ```
- Decisions:
  - **Graph:** voices → a per-player lowpass `BiquadFilterNode` → a player gain → `musicBus()`.
  - **Lowpass cutoff:** `8000 − 7000 × danger` Hz for tiers 0–2, and 1200 Hz in tier 3. Always applied with `setTargetAtTime(…, 0.3)`.
  - **Frequency:** `freq = 440 × 2^((semi + getTranspose() + keyOffset) / 12)`. The composer's `keyOffset` changes are mirrored with `setTranspose(roundKey + keyOffset)`, so effects follow.
  - **Scheduler:** every 25 ms, queue all composer bars whose start time is before `now + 0.12`. Stingers from `events()` are scheduled immediately at their quantized step times.
  - **Down:** the "tape stop". The player gain falls to 0 over 0.8 s, the lowpass ramps to 200 Hz, and one saw glide runs 300 → 60 Hz at low gain.
  - **Revive:** fades back in over 0.5 s from the next bar.
  - **Pause:** fades out over 0.15 s and stops the timer. **Resume:** restarts from the next bar at the current time.
  - **Dispose:** stops the timer, disconnects the filter and gain, and sets `setTranspose(0)`.
  - **Voice recipes:** each voice is ≤ `MAX_GAIN × vel` and has its main energy ≥ 150 Hz. Suggested:
    - pluck: triangle with a fast exponential decay
    - pad: two detuned saws through a soft lowpass, slow attack
    - bass: triangle plus a 2× sine
    - lead: square with a vibrato LFO, lowpassed
    - stab: three saws, short
    - kick: a 160 → 60 Hz sine with a 2 kHz click so phones hear it
    - clap and hat: bandpassed and highpassed noise
    - fill: three quick toms
- **Lifecycle:**
  - Before `start()`, after `dispose()`, while paused and while the composer is down or ended: `events()` and `setMood()` are no-ops for scheduling and never throw.
  - If `ctx()` is null at `start()`, keep ticking and begin once it isn't null.

- [ ] **Step 1: Write failing tests** with a mock AudioContext (`currentTime` you advance) and fake timers:
  - `schedules_ahead_only`: after one tick at t=0, no oscillator starts later than 0.12 s plus one bar.
  - `scheduler_holds_no_backlog`: advance 300 s of ticks. The live timer count is 1, and the count of started-but-not-ended voices stays below a fixed bound (e.g. 64).
  - `events_when_idle_are_ignored`: events before start, while paused, after dispose, and after a gameover cadence create no oscillators and don't throw.
  - `starts_late_when_context_appears`: `ctx` returns null for 3 ticks, then a context. Notes begin within one bar after that.
  - `filter_tracks_danger_smoothly`: `setMood({tier:2, danger:1})` calls `frequency.setTargetAtTime(1000, …)`; tier 3 targets 1200.
  - `milestone_transposes_effects`: after `events([{e:'milestone'}])`, `getTranspose()` is roundKey + 1. After `dispose()`, it's 0.
  - `voices_respect_max_gain_and_disconnect`: every voice's peak gain is ≤ `MAX_GAIN`, and every created node is disconnected after its `onended`.

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS**, then `npm test`.

- [ ] **Step 5: Commit** — `feat: music instruments and look-ahead player with tape stop and pause`

---

### Task 5: Wire music into the game

**Files:**
- Modify: `src/game/session.ts` (create ~L143; cue loop ~L220; per-frame ~L267-275; pause, resume and dispose ~L322-356; revive and give-up)
- Modify: `src/main.ts` (round start ~L199), `src/ui/screens.ts` (overtake ~L1488)
- Test: `tests/music.session.test.ts` (pure helpers), plus the existing suites

**Interfaces:**
- Consumes: Task 4 `createMusicPlayer`, Task 2 `tierFor`, Task 1 `DangerState.raw`, `duckMusic`, `setTranspose`, `ROUND_KEYS`.
- Produces:
  - `Session.music: MusicPlayer`
  - `musicEventsFor(cues: Cue[]): { e: MusicEvent; size?: number }[]` in `src/game/music/fromCues.ts`:

    | Cue | Music event |
    |---|---|
    | steal | steal, with `size` = the same step's capture `pct` |
    | capture without steal | capture |
    | kill | kill, with `size` = streak |
    | escape | escape |
    | milestone | milestone |
    | down | down |
    | revive | revive |
    | win | win |
    | gameover | gameover |

    Other cues are dropped.
  - `onOvertake?: () => void` on the HUD options, so `screens.ts` can tell `main.ts`. Alternatively export a function `main` passes to the HUD, matching how the HUD is already constructed.
- Decisions:
  - **Session create:** seed `Math.floor(Math.random() * 2**31)` (game layer, not sim). Round key = `ROUND_KEYS[seed % 5]`; call `setTranspose(roundKey)`. Start the music when the session starts.
  - **Cue loop:** call `music.events(musicEventsFor(cues))` once per step, before the `playSound` loop, so a milestone fanfare already uses the new transpose. Call `duckMusic()` once if any cue is capture, steal, kill or milestone. The alert path also ducks.
  - **Per frame:** after `sampleDanger`, call `music.setMood({ tier: tierFor(h.trail.length > 0, danger.raw, danger.burn !== null), danger: danger.raw })`.
  - **Close escapes:** create the tension with `createTension((n, o) => { playSound(n, o); if (n === 'escape') music.events([{ e: 'escape' }]); })`.
  - **Lifecycle:** `pause()` → `music.pause()`, `resume()` → `music.resume()`, `dispose()` → `music.dispose()`. Give-up and game over flow through the gameover cue.
  - **Overtakes:** the toast path calls the overtake hook, and `main.ts` forwards it as `session.music.events([{ e: 'overtake' }])`.
  - **Menu:** silence (spec's builder choice).

- [ ] **Step 1: Write failing tests**
  - `music_events_from_cues`: covers steal + capture (size = pct), a lone capture, kill streak, and dropping heartbeat/alert.
  - `session_pause_resume_dispose_drive_music`: extend the existing session tests if they construct a session; otherwise inject `createMusicPlayer` via `SessionOpts.music?` for the test.

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run `npm test` and `npm run build`, expect PASS.**

- [ ] **Step 5: Browser check** with the `territory-wars` preview (port 5173):
  - no console errors through start → play → pause → resume → down → revive → game over → new round;
  - the Music slider changes the music bus gain (check via `javascript_tool`);
  - the mute toggle reads "Sound".

- [ ] **Step 6: Commit** — `feat: adaptive music in rounds — mood, events, overtakes, lifecycle`
