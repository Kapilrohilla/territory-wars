# Burning Trail, Difficulty and Revive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add three features to Territory Wars: a burning-trail kill rule, an Easy/Normal/Hard difficulty setting, and one revive per round.

**Architecture:**
- All rules live in the headless simulation (`src/sim/`) as plain serializable data on `World`/`Player`.
- The browser shell (`src/game/session.ts`, `src/game/render.ts`, `src/game/effects.ts`) and the DOM UI (`src/ui/`) present them.
- The tasks run in order, because every one of them touches `src/sim/world.ts`.

**Spec:**
- The user's request: "add revive, difficulty setting and burning trail".
- The original design is in `docs/superpowers/specs/2026-10-20-territory-wars-design.md`.
- The revive layout follows the user's own design, `docs/mobile-designs/03-revive.png`, which is described in Task 3.
- The research in `docs/research/mechanics.md` covers the original's burn: about 60 u/s, both directions, and you survive if you reach home.

## Global Constraints

- Everything stays original. Never use "Paper.io" or "Voodoo" anywhere.
- The sim stays headless and deterministic. All randomness goes through `world.rngState`, and World must survive a JSON round trip.
- Existing tests keep passing. `npm test` and `npm run build` must be clean, with no warnings.
- Commits end with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Burning trail

**Rule:** a head touching ANOTHER player's live trail no longer kills that player instantly.

- **The burn starts:** the victim's trail starts burning at the hit point. There are two fronts, each moving at `CONFIG.BURN_SPEED = 40` u/s along the trail's path length.
  - One front moves toward the victim's head. It chases the head and the growing trail, including the live tail from the last trail point to `pos`.
  - The other front moves toward the trail's start. It stops when it gets there.
- **Death:** when the head-ward front reaches the victim's head, the victim dies. The `death` event's `killerId` is the hitter, and the kill is credited at that moment, not at the hit.
- **Escape:** if the victim re-enters its own land before that, the burn is cancelled. The capture happens as normal, using the full trail including the burnt part, so escaping is rewarded.
- **Burnt section:** the part between the two fronts is harmless. Collision checks skip it, and the renderer doesn't draw it.
- **Repeat hits:** a hit on a trail that is already burning is ignored. The first hitter keeps the credit.
- **Unchanged rules:**
  - Hitting your OWN trail is still an instant death.
  - Head-on collisions are unchanged.
  - A capture that puts an enemy head inside the new region still kills that enemy instantly.
- **Data:** add this to `Player`:
  `burn: { s0: number; back: number; front: number; killerId: number } | null`
  - `s0` is the hit position in path length from `trail[0]`.
  - `back` and `front` are the current front positions, measured the same way.
  - It is null when the trail isn't burning, and it is cleared on capture, on death and on respawn.
- **Path length:** use the cumulative distance along `trail[0..n]` plus the live tail to `pos`. Provide a helper `trailLength(p): number` in `world.ts`.
- **Render (`render.ts`):**
  - Draw the trail without the burnt range `[back, front]`.
  - Draw a small glowing ember at each active front: an orange-pink circle about 0.5 u across, flickering with a sine wave on `world.time`.
- **Bots (`bots.ts`):** when a bot's own trail is burning, it goes straight into the `return` state toward the nearest point of its own land.
- **Tests (`tests/world.test.ts`):**
  - `trail hit starts a burn instead of killing`: the victim is still alive just after the hit, and `burn` is set with `killerId`.
  - `burn reaches head kills victim and credits killer`: let the victim keep moving away; it dies once `front` reaches the head (≈ distance/BURN_SPEED, with the head running at 10 u/s). `death.killerId` is the hitter and the hitter's `kills` has gone up by 1.
  - `reaching home cancels burn and still captures`: a victim close to home gets back first, survives, `burn` is null, and a `capture` event is emitted.
  - `burnt section is harmless`: a third player crossing the burnt range does not start a new burn and does not die.
  - `self trail still kills instantly`: this is the existing test, which must still pass.
  - Update the earlier test `hitting enemy trail kills owner and credits killer` to reflect the new rule: the owner dies after the burn, not on the same tick.

### Task 2: Difficulty (Easy / Normal / Hard)

- **Data:**
  - `type Difficulty = 'easy' | 'normal' | 'hard'`.
  - `createWorld` takes `difficulty?: Difficulty`, defaulting to `'normal'`, and stores it on `World`.
- **Table:** add `DIFFICULTY` to `config.ts`. Normal must equal today's behaviour exactly.

  | | easy | normal | hard |
  |---|---|---|---|
  | botCount | 8 | 12 | 14 |
  | botTurnRate | 3 | 4 | 6 |
  | huntRangeMul | 0.5 | 1 | 1.6 |
  | cautionTrail (u) | 18 | 25 | 34 |
  | waypointMax (u) | 11 | 15 | 20 |
  | burnSpeed (u/s) | 30 | 40 | 55 |

- **Wiring:**
  - The world uses `botCount`, `botTurnRate` and `burnSpeed`.
  - `bots.ts` uses `huntRangeMul`, scaling the 10 u and 15 u rays, and `cautionTrail` and `waypointMax`, all read from `world.difficulty`.
- **Best score:** it is now tracked per difficulty.
  - `src/ui/best.ts` gets a `difficulty` parameter, with the key `territory-wars.best.<difficulty>`.
  - On the first load, migrate the old `territory-wars.best` value into normal.
- **Home screen:**
  - A 3-way segmented control labelled "Difficulty", placed under the colour picker. It is keyboard accessible, with radio semantics and buttons ≥ 44 px tall.
  - The best-score panel shows the best for the selected difficulty and updates when the selection changes.
  - The choice is saved in prefs under the localStorage key `territory-wars.difficulty`.
- **Game-over / results screen:** shows the difficulty, e.g. a small "Hard" tag.
- **Tests:**
  - World bot counts are 8, 12 and 14 per difficulty.
  - Normal still matches all the existing tests.
  - The bots' hunt range scales: a hard bot hunts a trail 14 u ahead; a normal bot doesn't.
  - Best scores are kept separately per difficulty, and the legacy key is migrated.

### Task 3: Revive (once per round)

- **Sim (`world.ts`):**
  - `World` gets `revivesLeft: number` (starts at 1), `awaitingRevive: boolean` and `downKillerId: number | null`.
  - When the human dies and `revivesLeft > 0`: emit `{ type: 'down'; killerId }` (killerId is null for a self-kill), set `awaitingRevive = true`, and do NOT set `over`.
  - While `awaitingRevive`, `step()` does nothing at all. The world is frozen behind the modal.
  - `reviveHuman(world): void`:
    - Restore the human's land from the land it held at death (`dyingLand`). If that is empty, spawn a fresh start circle at a valid spawn point.
    - Put the head at a point inside the land: the centroid of the largest polygon if it is inside, otherwise the closest interior sample point.
    - Clear the trail and burn, set `alive = true`, decrement `revivesLeft`, set `awaitingRevive = false`, and give 2 s of protection (`Player.protectedUntil = time + 2`).
    - While protected, the human can't be killed: trail hits on the human's trail are ignored, a head-on doesn't kill the human, a capture region doesn't kill the human, and losing all land doesn't kill the human. The human can still kill others.
  - `declineRevive(world): void` sets `over = true`, `awaitingRevive = false` and emits `gameover`.
  - The second death, with `revivesLeft === 0`, works as today: `over` and `gameover`.
- **Session (`session.ts`):**
  - Add an `onDown(world, killerName | null)` callback, fired once about 600 ms after `awaitingRevive` becomes true, so the hit is visible first.
  - Add `revive()` and `giveUp()` methods. `revive()` calls `reviveHuman` and resumes. `giveUp()` calls `declineRevive`, then the existing over-tail runs and fires `onOver`.
  - Rendering keeps running while frozen.
  - Add `requestRevive: () => Promise<boolean>` to the session options. It defaults to `async () => true`; this is the future rewarded-ad hook. `revive()` awaits it and only revives when it resolves to true.
- **UI (`screens.ts`/`style.css`), the revive modal, after the user's design:**
  - A red "Knocked out!" pill and a big "Knocked out!" title.
  - A subtitle: "Rival <b>Name</b> crossed your trail", "You crossed your own trail", or "Rival <b>Name</b> crashed into you" for a head-on or capture-region kill. Pass the death cause in the event as `cause: 'trail' | 'self' | 'headon' | 'captured'`, and add `cause` to the `death`/`down` events.
  - A 5 s countdown ring (an SVG circle stroke animating down) with the seconds number and "SEC".
  - A 3-stat row: Best (for the current difficulty), Kills, Time.
  - A big green "Revive" button with the line "Keep 100% of your territory".
  - A text link "No thanks, view results".
  - When the countdown reaches 0, or "No thanks" is pressed, call `giveUp()`.
  - Keyboard: Enter revives, Escape gives up.
  - While the human is protected, the head blinks: alpha pulses at 6 Hz in `render.ts`.
- **Tests:**
  - The human's first death emits `down`, not `gameover`, and `step` is a no-op while `awaitingRevive`.
  - `reviveHuman` restores the land area to its value at death and puts `pos` inside the land.
  - The protection makes a trail hit on the human, made within 2 s, harmless.
  - The second death leads to `over`.
  - `declineRevive` leads to `over` with a `gameover` event.
  - The countdown and formatting helper in `screens.ts`, if it's extracted as pure, gets a unit test.
