# Interactivity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** make a round of Territory Wars feel alive from moment to moment. That means tension that builds and releases, warnings before danger arrives, captures that spread out, freeze-frames on kills, visible steering, a leaderboard that reacts, and settings for all of it.

**Architecture:**
- The sim (`src/sim/`) is not changed.
- New pure helpers live in `src/game/` and get unit tests. They compute danger, threats, wave radius, turn lean and leaderboard diffs from `World`.
- Rendering stays in `render.ts`/`effects.ts`, plus a new screen-space overlay module (`src/game/overlay.ts`).
- Sounds go in `sound.ts`/`sfxEvents.ts`. DOM HUD and settings go in `src/ui/screens.ts` and `style.css`.

**Spec / designs:**
- User-approved mockup: `docs/mobile-designs/interactivity/02-trail-on-fire.png`.
- Prompts for the other moments: `docs/mobile-designs/interactivity/PROMPTS.md`, sections 1 and 3–8. These are the visual reference.
- Design tokens are in that file and in `src/ui/style.css`: ember `#FF7A59`→`#FFB347`, danger pill bg `#FFE1E1` with text `#B4232F`, gold `#FFC93C` with lip `#C99A1E`, ink `#34323F`, and shield cyan `#6CC3EF`.

## Global Constraints

- Everything is original. Never use "Paper.io" or "Voodoo". All text is ink `#34323F`; never put white text on pastel.
- The sim stays headless and deterministic. Never call `Math.random` in `src/sim`.
- **Reduce motion** is the existing setting `REDUCED_MOTION_KEY` and also respects `prefers-reduced-motion`. When it is on, there is no pulsing, shaking, flashing, zoom punch or freeze-frame. Static versions of the indicators still show.
- **Performance:**
  - No allocations per frame in hot loops. Reuse arrays and objects.
  - New per-frame work is O(players + human trail points).
  - DOM text is written only when it changes, at most every 100 ms, except for animations.
- Every new sound is synthesized in `sound.ts`. There are no audio files, and every sound respects mute and the new SFX volume.
- `npm test` and `npm run build` are clean. Each commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Danger and burning-trail feedback (tension and release)

**Create `src/game/danger.ts`, a pure module:**
- **`dangerLevel(world: World): number`**, returning a value in [0,1] for the human. It is 0 when the human is home, dead or awaiting revive. Otherwise it is the max of:
  - trail exposure: `clamp01((trailLength - 6) / 34)`
  - rival proximity: `clamp01(1 - (d - 3) / 12)`, where `d` is the minimum distance from any alive rival head to the human's trail or head.
- **`burnProgress(world: World): number | null`**, returning a value in [0,1]. It is null unless the human's trail is burning. Otherwise it is `1 - remaining/initialGap`, where remaining is `trailLength - burn.front`, and the initial gap is the remaining distance stored the first time it is seen. Keep that cache in a small state object created per round.
- **`homeTarget(world: World): { point: Vec; dist: number } | null`**, the nearest point on the human's own land's outer rings. It is null while the human is inside its land.

**Create `src/game/overlay.ts`, a screen-space layer drawn after `render()` each frame:**
- **Danger vignette:** a radial gradient from transparent at 55% radius to `rgba(255,122,89, 0.28·danger)` at the edge.
- **Burning vignette:** it uses ember colours, pulses at 2 Hz (static when reduce motion is on), and has strength `0.25 + 0.35·burnProgress`.
- **Home arrow (while burning):**
  - A chunky gold arrow, `#FFC93C` with a lip, drawn 2.2 u from the head toward `homeTarget`.
  - Next to it is a chip in a white pill with a lip: "Home 6.2m", with distance shown to 1 decimal in world units.
- Respect the "danger warnings" setting. Task 7 adds it; for now read `localStorage['territory-wars.dangerWarnings'] !== '0'` through a tiny getter in `danger.ts`.

**DOM HUD in `screens.ts`:**
- **Top-center pill, shown while `danger ≥ 0.35` and not burning:**
  - It has a heart icon, the label "Far from home", and a 3-segment meter that fills by thirds of `danger`.
  - Segments are ember; the pill is translucent white.
  - The heart beats with CSS at a rate based on danger: animation-duration `1.0s − 0.55·danger`.
- **While burning, it is replaced by the danger pill "🔥 TRAIL ON FIRE — GET HOME! 🔥"** (bg `#FFE1E1`, text `#B4232F`, Rubik 800 uppercase), which pulses.
- **Fades:** the pill fades in over 200 ms and out over 300 ms.

**Sounds (`sound.ts`):**
- **Heartbeat:** a looping tension layer, scheduled from the session at most once per beat. It is a soft "lub-dub", two sine thumps at 55 Hz and 48 Hz about 0.12 s apart. Interval is `0.95 − 0.5·danger` s, and gain is `0.02 + 0.06·danger`. It plays only while danger is ≥ 0.35 or the trail is burning.
- **Burning crackle:** while burning, a filtered-noise crackle burst every `0.22 − 0.12·burnProgress` s.
- **Relief:** when danger falls from ≥ 0.35 to 0 because the human got home, play the existing `escape` sound if it hasn't already played in that step.
- **Implementation:** all of this lives in a `createTension()` controller in `sfxEvents.ts` or a new `tension.ts`, driven by `update(world, dtRealSeconds)`. It has unit-testable scheduling: given danger and elapsed time, it returns the beats due.

**Tests:**
- `dangerLevel` is 0 at home, rises with trail length, rises with a rival head nearby, and is 0 while awaiting revive.
- `burnProgress` is null when not burning and increases monotonically as the front advances.
- `homeTarget` is null at home and gives the nearest outer-ring point and distance when outside.
- Tension scheduling returns faster beats at higher danger and none below 0.35.

### Task 2: Threat warnings

**Create `src/game/threats.ts`, a pure module:**
- **`findThreats(world, out: Threat[]): Threat[]`** with `Threat = { id: number; colorIndex: number; dist: number; pos: Vec; trailPoint: Vec }`.
  - A threat is an alive rival whose head is within 18 u of the human's trail (excluding the last 1 u near the head) while the human is outside its land.
  - Sort by dist ascending and return at most 3. Reuse `out`, with no per-frame allocation.

**Render:**
- **Trail glow:** for each threat closer than 10 u, draw an ember glow on the human's trail around `trailPoint`, ±3 u of path length. The glow is a 0.9 u wide stroke with alpha `0.6·(1 − dist/10)`, plus a small "!" ripple ring that pulses at 3 Hz (static when reduce motion is on).
- **Off-screen arrows** (screen space, in `overlay.ts`), for threats whose head is off-screen:
  - **Shape and position:** a rounded triangular chip 34 px across, pinned 18 px inside the viewport edge where the line from the screen centre to the rival crosses the edge.
  - **Colour:** filled with the rival's base colour, with its lip as a 3 px bottom shadow.
  - **Contents:** a tiny face, using `faces.ts` at about 16 px, and the distance "8m" in ink.
  - **Closest threat:** scaled to 1.15 and pulsing.
- **Minimap:** ring threat rivals' dots in `#B4232F`.
- **First-time tooltip:** the first time an arrow ever shows, a tooltip "Rival heading for your trail" sits next to it for 2.5 s. The "seen" flag is stored in localStorage.

**Sound:** when a new rival becomes the closest threat under 8 u, play a short two-note "alert" blip. There is a cooldown of 2 s per rival.

**Tests:**
- Threats are found within 18 u.
- There are none when the human is home.
- Results are sorted and capped at 3.
- The near-head trail is excluded.
- `out` is reused, with no new array identity.

### Task 3: Capture wave

**In `effects.ts`, captures fill outward as a wave instead of rising everywhere at once:**
- **Origin:** the point where the loop closed, which is the human's position at the capture event. For bots it is their head position.
- **Radius:** `r(t) = maxDist · easeOutCubic(t / WAVE_S)`, where `WAVE_S = clamp(0.35 + 0.012·sqrt(area), 0.35, 0.9)` s and `maxDist` is the farthest region vertex from the origin.
- **Mask:** the region is clipped to the circle of radius r. Outside it, the region is drawn in the arena colour (still masked); inside, it is the owner's base colour with the existing lip rise.
- **Ripple rings:** 2–3 rings, `rgba(255,255,255,0.55)`, 0.25 u wide, at `r`, `r − 1.2` and `r − 2.4`, fading over the wave.
- **Reduce motion:** keep the old short fade.

**Capture sound:** the existing capture sound is extended into a rising sweep whose length matches `WAVE_S`. Add a `durationS` option to the capture cue, and pass it from `sfxEvents` using the same formula. Export `waveSeconds(area)` from one shared place.

**HUD % counter "bump":** on each human capture, the % card scales to 1.12 and back over 220 ms, with a tiny ▲ that fades. There is no bump when reduce motion is on.

**Milestone ribbon:** the milestone sound already plays at 10/25/50%. Add a gold ribbon at top-center reading "10% CLAIMED!", "25% CLAIMED!" or "HALF THE MAP!", with gold `#FFC93C`, lip `#C99A1E` and ink text. It comes with a confetti speck burst using DOM spans or the canvas, lasts 1.6 s, and slides in and out.

**Tests:**
- `waveSeconds` is clamped and monotonic.
- The wave radius is 0 at t=0, reaches `maxDist` at `WAVE_S`, and is monotonic.
- The milestone ribbon text is correct per tier, from a pure helper.

### Task 4: Knockout freeze-frame and streak banner

**Hit-stop:**
- **When:** when the human knocks someone out (a `death` event with `killerId === human`).
- **Freeze:** `session.ts` freezes the simulation for `HITSTOP_MS = 70`. No `step` calls happen during it; rendering continues and effects keep updating at 25% speed.
- **Zoom punch:** the camera gets a zoom punch, `cam.punch(0.12)` (a new Camera method), which springs back over 250 ms.
- **Reduce motion or the "freeze-frames" setting off:** no freeze and no punch.

**Slow-mo on the human's down:** for the 600 ms before the revive modal (`DOWN_DELAY_MS`), render at 35% speed. Ease the effects/time scale and keep the sim frozen, since the sim is already frozen while the revive is pending.

**Impact visuals (`effects.ts`), at the victim's head on a human kill:**
- A white flash ring that expands 0→2.5 u over 160 ms and fades.
- 8 short white impact lines radiating out.
- The existing confetti chunks stay.

**Streak banner (DOM, top-center):**
- A gold pill reading "KNOCKOUT!".
- From the 2nd kill within the existing streak window, an extra chip "×N STREAK" with a 🔥.
- It slides in, holds for 1.1 s and slides out.
- It replaces the floating kill text for the human, but the floating "+1" over the head stays.
- Use `killText`/streak state from `sfxEvents` (`SfxState.streak`); expose the streak to the UI through the session's events callback, or compute it in a shared pure helper.

**Tests:**
- Hit-stop scheduling: `createHitStop()` returns `shouldStep(nowMs)` false for 70 ms after `trigger(nowMs)`, then true again. Triggers overlap by extending.
- Streak chip text: N=1 gives no chip, N=3 gives "×3 STREAK".

### Task 5: Steering feedback

**Input:**
- `input.ts` exposes `pointer(): { anchor: Vec; current: Vec; active: boolean } | null` in CSS px. It is null when no drag is active, and it reuses its object.

**Overlay (`overlay.ts`), while a drag is active (touch or mouse):**
- A soft translucent white ring, 120 px across, at the anchor, with a faint lip shadow.
- A periwinkle knob 44 px across in the player's skin colour, offset toward `current` and clamped to a 38 px radius.
- A subtle heading arrow on the knob.
- Fade in over 120 ms and out over 180 ms.

**Head lean and squash (`render.ts`):**
- Compute turn rate per frame as `angleDiff(heading, prevHeading)/dt`.
- **Lean:** rotate the head by `clamp(turnRate·0.06, −0.35, 0.35)` rad.
- **Squash:** scale `sx = 1 + 0.12·k` and `sy = 1 − 0.12·k`, where `k = clamp(|turnRate|/6, 0, 1)`.
- **Smoothing:** smooth both with a critically damped lerp, factor `1 − exp(−12·dt)`.
- **Motion swooshes:** 2 small swoosh arcs behind the head while `k > 0.6`.
- **Reduce motion:** no lean and no squash.
- Put the math in a pure `leanPose(turnRate)` with tests.

**First-time tip:** on the first ever round, a speech bubble "Drag anywhere to steer" (or "Use arrow keys or drag to steer" on desktop) sits near the bottom-center for 3 s or until the first steer. Store "seen" in localStorage.

**Tests:** `leanPose` is clamped and symmetric. `pointer()` is null without a drag.

### Task 6: Leaderboard reactions

**Pure helper `rankChanges(prev: BoardRow[], next: BoardRow[]): { overtaken: { name: string }[]; humanDelta: number }`:**
- Report which rivals the human passed, meaning they were above the human before and are below now.
- Report the human's rank delta.

**HUD (`screens.ts`):**
- Rows animate position changes with FLIP: transform translateY from the old position, transitioning over 280 ms with an ease-out.
- When the human moves up, the human's row flashes a soft periwinkle glow and shows a green "▲1" (or ▲N) for 1.2 s.
- A toast under the leaderboard reads "You passed Mango!", or "You passed 2 rivals!" when there are several. It is a white pill with a lip and a tiny rival colour swatch. It shows for 1.6 s, with at most one toast every 1.5 s.
- A gold crown icon marks the leader row; the ★ is replaced by a crown glyph (👑 or an SVG).
- Play a soft rising tick sound on an overtake.
- Reduce motion: no FLIP slide and no flash, but the toast still shows.

**Tests:** `rankChanges` covers passing one rival, passing two, dropping, and no change.

### Task 7: Sound & Feel settings, plus directional sound

These go in the existing Records & Settings screen (`screens.ts`), in its own "Sound & Feel" section that follows the existing settings markup and style:
- **Sound effects volume slider (0–100, default 80):** `sound.ts` `setVolume(v)` scales the master gain. It is persisted under `territory-wars.sfxVolume`, and mute still overrides it. Moving the slider plays a preview tick.
- **Directional sound toggle (default on):** `playSound` accepts an optional world position.
  - The session passes the event position: capture at the head, cut at the hit, kill at the victim, burning at the head.
  - `sound.ts` routes the cue through a StereoPannerNode, with `pan = clamp((screenX − w/2)/(w/2), −1, 1)·0.7`, using the camera's `worldToScreen`.
  - Off-screen events attenuate by distance: gain × `clamp01(1.4 − d/60)`.
  - When the toggle is off, pan is 0. Persisted under `territory-wars.directional`.
  - A pure `panFor(screenX, width)` helper has a test.
- **Danger warnings toggle (default on):** persisted under `territory-wars.dangerWarnings`. It turns off Task 1's pill, vignette and heartbeat and Task 2's arrows and glow, but not the burning banner or the crackle, which stay because they are critical.
- **Screen shake and freeze-frames toggle (default on):** persisted under `territory-wars.impact`. It turns off Task 4's hit-stop and punch and the existing camera nudge.
- **"Test sounds" button:** plays capture → cut → kill with short gaps.
- **Existing settings stay as they are:** Vibration and Reduce motion. Reuse a single settings getter module, `src/ui/settings.ts`, for all flags, with try/catch around storage.

**Tests:**
- Settings getters fall back to defaults when storage is missing or corrupt.
- `panFor` is clamped.
- Volume maps 0–100 to gain 0–1.

### Task 8: Smarter Hard bots (fair: same speed and rules as the player)

The user chose **smarter only**: no speed boost and no rule changes.

**Scope:**
- All new behaviour is gated by flags in the `DIFFICULTY` table (`src/sim/config.ts`). Add these fields to `DifficultyTuning`, with all of them off or 0 for easy and normal:
  - `smartHunt: boolean`
  - `huntRadius: number`
  - `packSize: number`
  - `raidChance: number`
  - `safeReturn: boolean`
  - `loopScale: number`
- Easy and Normal must behave exactly as today. Their existing bot tests are the regression baseline.
- The sim stays deterministic: only the `rng` passed into `botInputs` is used. Bot per-tick cost stays O(bots × human trail points), and the trail scan uses the same bounding-box cull as `src/game/threats.ts`.

**Hard behaviours (`src/sim/bots.ts`):**
1. **Cut near the head** (`smartHunt`).
   - Target choice: when hunting, aim for the point on the human's live trail that minimises `distToBot + 1.5·pathLengthFromHumanHead`. So it is close to the human's head, but reachable.
   - Lead the target: aim slightly ahead of where the trail segment will be by the time the bot gets there, using the human's current heading for the live tail.
   - Still obey self-trail avoidance and wall avoidance.
2. **Wider awareness** (`huntRadius = 25` u). Hard bots consider any human trail point within 25 u in any direction, not just the ray cones. They only commit to a hunt if they can reach the target point before the human reaches home. Estimate this as `botDist / SPEED < homeDist / SPEED + 0.4` s, using `homeTarget`-style nearest-land distance computed in the sim. Duplicate a small helper rather than importing from `src/game`.
3. **Pack hunting** (`packSize = 3`).
   - Commitment: at most `packSize` bots commit to hunting the human at once. The closest ones are chosen, and the choice is re-evaluated every 0.5 s of world time, not every tick.
   - Pincer approach: committed bots spread their approach by aiming at different trail points, spaced ≥ 6 u of path length apart.
   - Everyone else: non-committed bots keep expanding.
4. **Raids** (`raidChance = 0.25`): when planning a new trip, with probability `raidChance` (from `rng`), a Hard bot plans its outward waypoints so the loop passes through the nearest edge of the human's land, if that land is within 30 u. This steals territory. It must still return to its own land to capture.
5. **Safe return** (`safeReturn`): an 'out' bot switches to 'return' when the human's head is closer to any point of the bot's trail than the bot is to its own land (plus a 2 u margin). The same check applies to rival bots' heads.
6. **Bigger loops** (`loopScale = 1.35`): the waypoint spacing upper bound and the `MAX_TRAIL_LEN` cap are both multiplied by `loopScale` on Hard. Loops become bigger, but safe-return guards them.

**Tests (`tests/bots.test.ts`, deterministic seeds):**
- Normal regression: the existing tests pass unchanged, and a fixed-seed 30 s Normal world gives the same JSON before and after the change. Record a snapshot hash from the baseline commit.
- `smartHunt`: given a human trail with the head at one end, a Hard bot's target is nearer the head than the plain nearest point would be.
- Wide awareness: a Hard bot notices a trail 20 u away at 120° off its heading; a Normal bot does not.
- Reachability: a Hard bot does not commit when the human is 1 u from home and the bot is 15 u away.
- Pack: with 5 eligible Hard bots, at most 3 are hunting at once.
- Raid: with a seeded rng that triggers a raid, the planned waypoints intersect the human's land.
- Safe return: an 'out' Hard bot with the human near its trail switches to 'return'.
- **Difficulty check** (a test or bench script with the numbers recorded in the report): run 3 seeds × 60 s of bots-only worlds per difficulty with the human parked at home, and compare average bot land % and bot self-death counts. Hard bots should hold more land on average than Normal, with no more self-deaths.

**Commit:** "feat: smarter Hard bots — head cuts, pack hunts, raids, safe returns".
