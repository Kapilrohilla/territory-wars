# Adaptive music: design

**Date:** 2026-10-24
**Status:** approved by the user (2026-10-24)

## Intent

Territory Wars has rich synthesized sound effects but no music. Add music that stays out of the way while you're calm and comes alive when the game does. It must never feel like "the same loop again", since that's what would make the player mute it.

All music is **generated in code** with the Web Audio API, the same way as the existing effects in `src/game/sound.ts`. There are no audio files: it works offline, adds almost nothing to the app size, and every musical hit can land on the beat and in key.

## What the player should experience (agreed in conversation)

- **Calm by default.** Safe at home, the music is soft background: a warm pad and gentle plucks, with no hummable tune.
- **Never the same twice.** Over a 3–5 minute round the music keeps changing, and there's no audible fixed loop.
- **Catchy only when something exciting happens.** A real, hummable melody appears for a few bars after an exciting moment, then fades back to background.
- **Stealing someone's land is the musical peak.** It gets a bouncy "gotcha" riff on the beat, then the fullest, catchiest version of the music for a few bars. Bigger steals get a longer, bigger version.
- **Other exciting moments get smaller lifts, all clearly below a steal.** These are a plain capture, a kill, a close escape (getting home while in danger or burning) and an overtake.
- **Danger tightens the music without turning it scary.** Leaving home with a trail adds bass and light drums. Rising danger muffles and tightens the mix (lowpass, a pulsing bass note). The trail burning strips it to low, urgent drums until you're safe.
- **Milestones** (10 / 25 / 50 %) move the music up a key for the rest of the round.
- **Getting downed:** a "tape stop", where the music slows and drops in pitch, then silence. A revive brings it back in.
- **Win / game over:** a short closing phrase instead of a hard cut.
- **A Music volume slider** in Sound & Feel, separate from sound-effects volume. The existing mute silences both.

Calm and danger behaviour plus the event mapping were proposed by me and accepted by the user ("looks right, go ahead").

## Goals

1. Adaptive, generative background music driven by the game state the session already computes (`DangerState`, burn progress, home/outside) and the cues `soundsFor` already emits.
2. Event hits (stingers) quantized to the music's beat grid and in the current key.
3. Enough built-in variety that a full round never repeats an identical 8-bar stretch.
4. A Music volume setting, persisted like the SFX volume.
5. It should sound good on **phone speakers**, the main platform (Android via Capacitor): nothing important below ~150 Hz, as learned from the heartbeat work.

## Non-goals

- No audio files, samples or third-party music libraries.
- No new game rules; the sim (`src/sim`) is untouched.
- No per-skin or per-difficulty soundtracks (difficulty may nudge tempo or intensity; see "left to the builder").
- No music editor or tracker UI.

## Anti-goals (failure even if it "works")

- A recognisable loop that repeats every few bars.
- Music that masks gameplay sounds. Capture, steal, kill, alert and heartbeat cues must stay clearly audible over it.
- Music that clashes with the effects: wrong key, off-beat stingers, or beating against the heartbeat.
- Frame drops or audio glitches on a mid-range phone, or timers and audio nodes that leak across rounds, pause or revive.
- A scary or aggressive soundtrack. It stays bright, pastel and casual even under tension.

## Constraints

- **Stack and style:** TypeScript, Web Audio. Follow the existing `sound.ts` patterns: one shared `AudioContext`; the master chain master → limiter → trim (`LIMITER_TRIM`); `safeStorage` via `src/ui/settings.ts`; all storage access inside try/catch.
- **Mixing:** music gets its own gain bus that feeds the existing master, so mute and the limiter apply to it. Music volume is independent of SFX volume.
- **Scheduling:** notes are scheduled ahead on the AudioContext clock (a look-ahead scheduler, e.g. a timer every ~25 ms queueing notes ~100 ms ahead), not fired from `requestAnimationFrame`. rAF pauses when the tab is hidden, and visual-frame timing jitters.
- **Lifecycle:** music starts with a round. It stops or fades on pause, the revive offer, game over and dispose, and leaves no scheduled callbacks or connected nodes behind. A hidden tab or app pause silences it.
- **Reduce motion** doesn't affect music. Mute does.
- **Testing:** pure parts (harmony and variation choices, quantization, intensity mapping, settings) get Vitest unit tests with a seeded RNG. The audio graph is tested with the same mock-AudioContext style as `tests/sound.test.ts`.
- **Repo rules:**
  - Never commit `*.apk`, `image.png`, `image copy.png`, `.claude/` or `docs/mobile-designs/3d/`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - All content is original.

## How it fits the existing code (builder's starting points)

- `src/game/sound.ts`: shared context, master chain, mute and volume. The music bus hangs off `master`.
- `src/game/session.ts`: `sampleDanger` runs once per frame and `tension.update(world, dt, danger)` runs right after. Cues flow through the `playSound(cue.name, cue)` / `tension.heard(...)` / `opts.onCue` block (~L220). Music should read the same `DangerState` and hear the same cues; it must not compute its own danger.
- `src/game/sfxEvents.ts`: `soundsFor` already emits `steal` (land taken from a rival, including absorbing a victim), `capture` (with `pct` and `durationS`), `kill` (with `streak`), `escape`, `milestone` (with `tier`), `down`, `revive`, `win` and `gameover`. Overtakes come from the HUD's `rankChanges` path. The steal cue plays the stolen area through `capture.pct`; "bigger steal" can scale on that.
- `src/game/tension.ts`: heartbeat and crackle. Tempo should either lock the heartbeat to the music's beat or keep them from audibly fighting.
- `src/ui/settings.ts` and the Sound & Feel card in `src/ui/screens.ts`: add `getMusicVolume`/`setMusicVolume` (key `territory-wars.musicVolume`) and a slider next to the SFX one. "Test sounds" may also preview music briefly.

## Decided by the user (after the builder check)

- **Effects follow the music's key.** `sound.ts` gets a global transpose that every pitched effect reads. Each round's key and each milestone key change shift the effects with the music, so everything is always in tune together. Effects keep their shapes; only their pitch moves. Keep transposes within a modest range so effects stay pleasant on phone speakers. Update the existing sound tests accordingly.
- **The music still reacts to danger when Danger warnings are off.** That setting removes only the arrows, the danger pill and the heartbeat. Expose the raw danger level from `sampleDanger` (before the warnings setting zeroes it) for the music to read, and update `danger.ts` and its tests.

## Decided (my calls; the user didn't specify)

- **Style:** bright major-key pop: about 108–120 BPM, plucks (marimba/kalimba-like), a warm pad, a soft round bass (with upper harmonics so phones hear it), light claps/shakers/hats and a lead voice for the catchy melody.
- **Variety** comes from:
  - a seeded generator choosing chord progressions from a small set of compatible ones every 4–8 bars;
  - generated pluck patterns and melodies built from motifs, with rhythmic and pitch variation;
  - instruments drifting in and out;
  - each round starting in a different key from a small pleasant set (pitched so stingers and existing effects still sit well).
- **Intensity model:** one continuous "energy" value plus a short-lived "excitement" boost. Energy follows game state: home → out → danger → burning. Events add excitement, which decays over a few bars. The layers and the melody are switched by these two values. The scale of the boosts sets the ranking: **steal > capture/kill > escape/overtake.**
- **Stingers land on the next beat (or next half-beat if that's close enough to feel instant)**, in key. The existing event effects keep playing as they do now; stingers are musical additions, not replacements. If a stinger and an effect clash audibly, adjust the stinger.
- **Menu / home screen:** a very quiet calm version, or silence. It's the builder's choice, but if played, it must stop cleanly when a round starts.
- **Default music volume:** a bit lower than SFX (e.g. 50 vs SFX 80).
- **Volume buses:** today `masterLevel()` folds the SFX volume into `master`. Split it into a shared master (mute, limiter, trim) feeding two buses, SFX (SFX volume) and music (music volume), so each slider moves only its own sound.
- **Close-escape hook:** the relief chime is played by `tension.ts` directly, not through the cue loop, so the music hears escapes from there.
- **Overtake hook:** overtakes come from the HUD's `rankChanges` path in `screens.ts`/`main.ts`, so the music gets an explicit entry point the HUD calls.
- **Mute label:** the Sound & Feel mute toggle now silences music too, so relabel it (e.g. "Sound").

## Left to the builder

- Exact progressions, motif library, instrument synthesis recipes, tempo, and how many layers.
- Whether the heartbeat locks to the beat grid or the music ducks around it.
- Whether difficulty nudges tempo or energy.
- Exact decay times, quantization tolerance and ducking amounts, tuned by ear and kept within the anti-goals.
- File layout. A sensible split: a pure "composer" module (decides what to play) apart from the Web Audio "player" (schedules it).

## Success

On a phone:
- a full round sounds varied;
- calm moments are unobtrusive;
- stealing land is clearly the most exciting musical moment;
- danger feels tighter but still friendly;
- gameplay sounds stay clear;
- muting and the Music slider work.

Tests and build pass. Frame time doesn't regress noticeably.
