# Territory Wars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, browser-based territory-capture game, "Territory Wars", in which you play against 12 bots on a circular pastel arena.

**Architecture:**
- A pure, headless simulation (`src/sim/`) holds all rules as plain serializable data and advances on a fixed 60 Hz tick.
- Bots (`src/sim/bots.ts`) produce steering inputs for the simulation.
- The browser shell (`src/game/`, `src/ui/`) runs the fixed-timestep loop, reads input, renders the scene to Canvas 2D with tick interpolation, and draws the HTML UI overlays.

**Tech Stack:** TypeScript 5, Vite 5, Vitest 2, `polygon-clipping` (MIT) for polygon union/difference. No game framework.

**Spec:** `docs/superpowers/specs/2026-10-20-territory-wars-design.md`. Mechanics research: `docs/research/mechanics.md`.

## Global Constraints

- The name is "Territory Wars". Never use "Paper.io", "Voodoo", or any of the original game's names, text, art or name lists.
- Arena: a circle of radius `100`, centred at (0,0). The edge is a non-lethal wall: positions are clamped inside it.
- Start land: a circle of radius `3`, approximated with 24 vertices. Spawn ≥ `20` u from the human, clear of other land and trails. If no valid spawn exists, retry every `1` s.
- Speed: `10` u/s for everyone. Turn: `heading += angleDiff(target, heading) * min(dt, 0.04) * turnRate`, with turnRate `8` for the human and `4` for bots. The simulation runs at a fixed `dt = 1/60`.
- Trail: drop a point every `0.25` u while outside own land. The player's own most recent trail segments (within `1.0` u of path length of the head) are not dangerous to itself.
- Capture: new land = fillHoles(union(ownLand, thickTrail)). Subtract the new land from every other player. An enemy keeps the piece containing its head (or, when it is out on its trail, the piece nearest its head). An enemy whose head is inside the new land dies. An enemy left with zero land dies. Trails inside a captured area stay live.
- Kills: a head touching another player's trail kills that trail's owner, and the toucher gets +1 kill. A head touching its own dangerous trail kills itself. Head-on (heads within `1.0` u): the player with less area dies; on a tie, both die.
- Death: land shrinks away over `0.5` s, then becomes neutral (it is removed).
- Bots: `12` bots. A dead bot respawns after `2` s with a new name from our own original list.
- Score: `% = area / (π·100²) × 100`. Win when the human's % ≥ `99.5`. If the human dies, the game is over (no revive).
- Camera: view half-height eases from `20` to `30` as the human's % goes from 0 to 50.
- Performance: 60 fps with 13 players. Simplify trail polylines before boolean operations.
- The APK must never be committed (it is in `.gitignore`).

## Review Focus

1. **Capture where the trail exits and re-enters at far-apart points on a concave border.** The enclosed area must be captured, with no slivers or crashes. This is tested in Task 2 (`captures C-shaped enclosure`).
2. **A capture that splits an enemy into two pieces while the enemy is out on its trail.** The enemy keeps the nearest piece and does not crash. This is tested in Task 2 (`enemy out on trail keeps nearest piece`).
3. **A tiny loop (re-entering after only 1–2 trail points).** There must be no exception and no NaN, and the area must not shrink. This is tested in Task 2 (`tiny trail does not shrink land`).
4. **Riding along the arena wall while outside your land.** The clamp must keep the trail valid and the capture must still work. This is tested in Task 3 (`wall clamp keeps player inside and trail valid`).
5. **Tab hidden, then resumed.** The loop must clamp its frame accumulator so the simulation doesn't fast-forward hundreds of ticks. This is tested in Task 5 (`accumulator clamps large frame gaps`).

---

## File Structure

```
index.html                  page shell, canvas, UI overlay roots
src/main.ts                 bootstraps app: menu → game → game over
src/sim/config.ts           all tuning constants (Global Constraints values)
src/sim/geometry.ts         vectors, angles, polygon area, point-in-polygon, segment tests, circle polygon
src/sim/territory.ts        land ops on MultiPolygon: area, contains, capture, subtract, keepPiece
src/sim/types.ts            Player, World, Input types (plain data)
src/sim/world.ts            createWorld, spawnPlayer, step(world, inputs) — movement, trail, capture, kills, respawn, events
src/sim/bots.ts             botInput(world, botId, rng) → Input
src/sim/names.ts            original bot name list
src/sim/rng.ts              seeded PRNG (mulberry32)
src/game/loop.ts            fixed-timestep loop with accumulator clamp + interpolation alpha
src/game/input.ts           pointer floating-joystick + keyboard → target heading
src/game/camera.ts          follow + zoom easing
src/game/render.ts          canvas drawing: arena, land with lip, trails, players, effects
src/game/effects.ts         capture fill-in, floating "+x.x%" text, camera nudge, death shrink
src/game/palette.ts         pastel colours
src/ui/screens.ts           start screen, HUD (%/kills/leaderboard), game-over/win screen
src/ui/style.css            UI styles
tests/*.test.ts             vitest unit tests for sim + loop
```

---

### Task 1: Scaffold, config, geometry

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` (minimal), `src/main.ts` (placeholder), `src/sim/config.ts`, `src/sim/geometry.ts`, `src/sim/rng.ts`, `tests/geometry.test.ts`

**Interfaces:**
- Produces:
  - `type Vec = { x: number; y: number }`
  - `type Ring = Vec[]`
  - `type Poly = Ring[]` (outer ring first, then holes)
  - `type MultiPoly = Poly[]`
  - `angleDiff(a: number, b: number): number` (result in (-π, π])
  - `ringArea(r: Ring): number` (absolute value)
  - `polyArea(p: Poly): number` (outer minus holes)
  - `pointInRing(p: Vec, r: Ring): boolean`
  - `pointInPoly(p: Vec, poly: Poly): boolean` (holes excluded)
  - `segIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean`
  - `distPointSeg(p: Vec, a: Vec, b: Vec): number`
  - `circleRing(c: Vec, r: number, n: number): Ring`
  - `clampToCircle(p: Vec, r: number): Vec`
  - `simplifyPolyline(pts: Vec[], tol: number): Vec[]` (Ramer–Douglas–Peucker)
  - `mulberry32(seed: number): () => number`
  - `CONFIG` object holding every Global Constraints number: `ARENA_R`, `START_R`, `START_VERTS`, `SPEED`, `TURN_HUMAN`, `TURN_BOT`, `TURN_DT_CAP`, `DT`, `TRAIL_STEP`, `SELF_SAFE_LEN`, `HEAD_ON_DIST`, `BOT_COUNT`, `BOT_RESPAWN_S`, `SPAWN_MIN_DIST`, `SPAWN_RETRY_S`, `DEATH_SHRINK_S`, `WIN_PCT`, `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_FULL_PCT`.

- [ ] **Step 1:** Set up the project.
  - Run `npm init -y`.
  - Install dev dependencies: `typescript vite vitest`. Install dependency: `polygon-clipping`.
  - Add scripts `dev` (vite), `build` (`tsc --noEmit && vite build`) and `test` (`vitest run`).
  - In tsconfig, set `strict: true`, target ES2020 and moduleResolution `bundler`.
- [ ] **Step 2:** Write the failing tests in `tests/geometry.test.ts`:
  - `angleDiff(0.1, 2π-0.1) ≈ 0.2`
  - `angleDiff(π/2, 0) ≈ π/2`
  - `ringArea` of the unit square = 1
  - `polyArea` of a 4×4 square with a 2×2 hole = 12
  - `pointInPoly` is true inside, false in the hole, false outside
  - `segIntersect` is true for an X crossing and false for parallel segments
  - `circleRing({0,0},3,24)` has 24 points and an area within 3% of π·9
  - `clampToCircle({200,0},100)` → `{x≈100, y≈0}`
  - `simplifyPolyline` of 100 collinear points with tol 0.01 → 2 points
  - `mulberry32(1)` is deterministic: two generators with the same seed produce equal sequences.
- [ ] **Step 3:** Run `npx vitest run tests/geometry.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4:** Implement `src/sim/geometry.ts`, `src/sim/rng.ts` and `src/sim/config.ts`, using the exact values from Global Constraints.
- [ ] **Step 5:** Run `npm test`. Expected: all PASS. Then run `npm run build`. Expected: success.
- [ ] **Step 6:** Commit: `feat: scaffold project with geometry utils and config`.

---

### Task 2: Territory operations and capture

**Files:**
- Create: `src/sim/territory.ts`, `tests/territory.test.ts`

**Interfaces:**
- Consumes: the geometry types from Task 1, and `polygon-clipping` (`union`, `difference`, which use `[x,y]` pair arrays; convert at the boundary).
- Produces:
  - `landArea(m: MultiPoly): number`
  - `landContains(m: MultiPoly, p: Vec): boolean`
  - `thickTrail(trail: Vec[], width: number): MultiPoly`. Simplify the trail with tol `0.05`, then union one quad per segment plus a small square at each vertex. Use width `0.6`.
  - `captureLand(own: MultiPoly, trail: Vec[]): MultiPoly`. Compute `union(own, thickTrail(trail))`, then drop every hole ring (this fills enclosed regions).
  - `subtractLand(m: MultiPoly, cut: MultiPoly): MultiPoly`
  - `keepPiece(m: MultiPoly, head: Vec): MultiPoly`. Return the single polygon containing `head`. If none contains it, return the polygon whose outer ring has the nearest vertex/edge to `head`. Return `[]` if `m` is empty.

- [ ] **Step 1:** Write the failing tests in `tests/territory.test.ts`:
  - `captures square loop`: own = 10×10 square at the origin. The trail leaves at (10,5), goes out to (15,5), (15,15), (5,15), and re-enters at (5,9). The result area is ≥ 10·10 + the enclosed L-region (≈ 75), within ±3.
  - `captures C-shaped enclosure`: own = a C shape (concave). The trail closes the mouth of the C. The mouth area is added (the area grows by ≈ the mouth area ±5%), and the result is a single polygon.
  - `tiny trail does not shrink land`: a trail of 2 points, both inside or on the border. The area is ≥ the original area.
  - `subtractLand removes overlap`: subtracting a 5×5 square from a 10×10 square gives area 75.
  - `enemy split keeps head piece`: an enemy bar is split by a vertical cut, and the head is in the right piece. `keepPiece` returns only the right piece.
  - `enemy out on trail keeps nearest piece`: the head is outside both pieces but closer to the left one, so the left piece is returned.
  - `keepPiece of empty is empty`.
- [ ] **Step 2:** Run `npx vitest run tests/territory.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/sim/territory.ts` with the signatures above.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: territory capture and subtraction`.

---

### Task 3: World simulation (movement, trail, capture, kills, respawn)

**Files:**
- Create: `src/sim/types.ts`, `src/sim/world.ts`, `src/sim/names.ts`, `tests/world.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `type Input = { targetHeading: number | null }` (null keeps the current target).
  - `type Player`:
    ```ts
    {
      id: number;
      name: string;
      colorIndex: number;
      isHuman: boolean;
      alive: boolean;
      pos: Vec;
      prevPos: Vec;
      heading: number;
      targetHeading: number;
      land: MultiPoly;
      trail: Vec[];
      kills: number;
      deathTime: number | null;
      respawnAt: number | null;
      dyingLand: MultiPoly | null;
    }
    ```
  - `type GameEvent`:
    ```ts
    | { type: 'capture'; playerId: number; gainedPct: number; region: MultiPoly }
    | { type: 'death'; playerId: number; killerId: number | null }
    | { type: 'win' }
    | { type: 'gameover' }
    ```
  - `type World = { time: number; players: Player[]; humanId: number; events: GameEvent[]; over: boolean; won: boolean; seed: number }`
  - `createWorld(opts: { seed: number; humanName: string; humanColor: number }): World`. The human is id 0 at (0,0). Bots are spawned via `spawnPlayer`.
  - `spawnPlayer(world: World, p: Player, rng: () => number): boolean`
  - `step(world: World, inputs: Map<number, Input>): void`. Advance by `CONFIG.DT`. Clear `world.events`, then push the new events.
  - `pct(world: World, id: number): number`
- Step order, per alive player:
  1. Turn.
  2. Move at SPEED·DT.
  3. Clamp to the arena.
  4. If outside own land: append a trail point when ≥ TRAIL_STEP from the last one. The first point appended is the last position inside the land.
  5. If inside own land with a non-empty trail: capture, apply the results to others, emit `capture`, and clear the trail.

  Then resolve collisions:
  - Trail hits: test head segment `prevPos→pos` against every trail segment. For the player's own trail, exclude the last `SELF_SAFE_LEN` of path length.
  - Head-on hits.

  Then:
  - Dead players: set `dyingLand` and clear `land`.
  - Respawn bots once `time ≥ respawnAt`, retrying every SPAWN_RETRY_S.
  - Set `win`/`gameover`.

- [ ] **Step 1:** Write the failing tests in `tests/world.test.ts`. Each test builds a world with seed 1, then manipulates players directly.
  - `human moves at 10 u/s`: 60 steps heading 0 → x ≈ 10 ± 0.2.
  - `turn eases, does not snap`: after 1 step with target π/2, the heading is between 0 and π/2 exclusive.
  - `trail spacing 0.25`: after leaving the land and 1 s outside, the trail has ~40 points (35–45).
  - `closing loop captures and emits event`: drive a square loop with scripted targets. Land area increases, a `capture` event is emitted, and the trail is empty.
  - `hitting enemy trail kills owner and credits killer`.
  - `self trail kills self` (loop back across your own older trail).
  - `head-on smaller dies`.
  - `enemy head inside captured land dies`.
  - `wall clamp keeps player inside and trail valid`: drive into the wall for 3 s. |pos| ≤ 100 + 1e-6, and every trail point is within the arena.
  - `pct of fresh human ≈ 0.09` (π·9 / π·10000 × 100 = 0.09, ±0.01).
  - `bots respawn after 2 s`.
  - `human death sets over and emits gameover`.
  - `win at 99.5%`: set the human land to the full arena circle, then step. `world.won` is true.
- [ ] **Step 2:** Run `npx vitest run tests/world.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `types.ts`, `names.ts` and `world.ts`.
  - `names.ts` holds at least 60 original, friendly made-up names (e.g. "Pixel Pete", "Mango").
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: world simulation with capture, kills and respawn`.

---

### Task 4: Bot AI

**Files:**
- Create: `src/sim/bots.ts`, `tests/bots.test.ts`

**Interfaces:**
- Consumes: `World`, `Player`, `Input` and `CONFIG` from Task 3.
- Produces:
  - `type BotBrain = { state: 'home' | 'out' | 'return' | 'hunt'; waypoints: Vec[]; }`
  - `createBrains(world: World): Map<number, BotBrain>`
  - `botInputs(world: World, brains: Map<number, BotBrain>, rng: () => number): Map<number, Input>`
- Behaviour:
  - **home:** pick a point on its own border, then 2 outward waypoints 3–15 u apart, and set state to out.
  - **out:** steer to each waypoint in turn, then set state to return.
  - **return:** steer to the nearest point of its own land.
  - **Caution:** if the trail length exceeds 25 u and the human head is within 12 u, switch to return.
  - **Hunt:** if the human trail is within 10 u ahead, or 15 u along ±45°, steer at the nearest point of that trail. Leave hunt when the target is gone.
  - **Wall avoidance:** if |pos| > 92, bias the target toward the centre.
  - **Self-trail avoidance:** if the target direction crosses its own trail within 3 u, rotate the target by ±60°.

- [ ] **Step 1:** Write the failing tests in `tests/bots.test.ts`:
  - `bot leaves home and returns, capturing land`: 1 bot, no human threat, simulate 20 s. Its area increased and it is still alive.
  - `bots survive 60 s mostly`: full world, human idle at home, simulate 60 s. At least 8 of the 12 bots never died from their own trail (count self-kills via death events where killerId === playerId).
  - `bot hunts nearby human trail`: place the human trail 6 u ahead of a bot. Within 1 s the bot's targetHeading points toward it (angle diff < 0.5 rad).
  - `bot avoids wall`: a bot at radius 95 heading outward turns inward within 1 s.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `src/sim/bots.ts`.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS.
- [ ] **Step 5:** Commit: `feat: bot AI`.

---

### Task 5: Game loop, input, camera, renderer

**Files:**
- Create: `src/game/loop.ts`, `src/game/input.ts`, `src/game/camera.ts`, `src/game/palette.ts`, `src/game/render.ts`, `tests/loop.test.ts`
- Modify: `index.html`, `src/main.ts` (wire up a playable game with no menus yet)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  - `createLoop(stepFn: () => void, renderFn: (alpha: number) => void, dt: number): { tick(nowMs: number): void; start(): void; stop(): void }`. The accumulator is clamped to `0.25` s.
  - `createInput(el: HTMLElement): { targetHeading(): number | null; dispose(): void }`
    - **Pointer:** floating joystick. The heading is `atan2` from the pointer-down point to the current point, applied once the drag is > 8 px. Releasing keeps the last heading.
    - **Keyboard:** arrows/WASD give 8 directions. Use the world convention: +y is down on screen.
  - `createCamera(): { update(target: Vec, pct: number, dt: number): void; worldToScreen(...); halfHeight: number; nudge(strength: number): void }`
  - `PALETTE: { bg: string; arena: string; grid: string; players: { base: string; lip: string; trail: string }[] }`, with 13 pastel entries.
  - `render(ctx: CanvasRenderingContext2D, world: World, cam, alpha: number, fx): void`.
    - Draw land as the outer ring filled with `lip`, offset +0.35 u downward, then `base` on top.
    - Draw trails as a semi-transparent ribbon of width 0.6 u.
    - Draw the player head as a rounded square 1.2 u, with a darker shade, rotated to the heading.
    - Positions are interpolated `prevPos→pos` by alpha.
- Rendering performance: cache each player's land as a `Path2D`, rebuilding it only when the land changes.

- [ ] **Step 1:** Write the failing tests in `tests/loop.test.ts`, using a fake clock:
  - `fixed steps per second`: ticking at 16.67 ms for 1 s calls step 60 ± 1 times.
  - `accumulator clamps large frame gaps`: one tick after a 5 s gap calls step ≤ 15 times (0.25 s / (1/60)).
  - `alpha in [0,1)`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the loop, input, camera, palette and renderer, and wire `main.ts`: create the world (seed `Date.now()`), brains and loop. The canvas fills the window with DPR scaling.
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: PASS and success.
- [ ] **Step 5:** Manual check. Run `npm run dev`, open the page and steer with the mouse and keys. Expected: smooth turning, bots moving, captures filling in.
- [ ] **Step 6:** Commit: `feat: playable game loop, input and renderer`.

---

### Task 6: Juice, UI screens, polish

**Files:**
- Create: `src/game/effects.ts`, `src/ui/screens.ts`, `src/ui/style.css`
- Modify: `src/main.ts`, `src/game/render.ts`, `index.html`

**Interfaces:**
- Consumes: the `GameEvent`s from Task 3, and the camera `nudge` and `render` from Task 5.
- Produces:
  - `createEffects(): { onEvents(events: GameEvent[], world: World, cam): void; update(dt: number): void; draw(ctx, cam): void }`
    - **Capture:**
      - The new region fades from 0→1 alpha with a scale of 1.04→1 over 200 ms.
      - For the human, a floating "+x.x%" (1 decimal) rises 2 u and fades over 900 ms.
      - Camera `nudge(0.3)`, plus `navigator.vibrate?.(15)` for the human.
      - A short soft "pop" synthesized with the WebAudio API (a sine blip, 660→880 Hz over 80 ms, gain 0.08). No audio files.
    - **Death:** draw `dyingLand` scaling toward its centroid and fading over `DEATH_SHRINK_S`.
  - Screens (DOM overlay):
    - **Start:** the title "Territory Wars", a name input (max 14 chars, default "You"), a 13-swatch colour picker, a Play button, and the controls hint.
    - **HUD:**
      - Top-left: your % (2 decimals) and kills.
      - Top-right: the leaderboard, with the top 5 by % plus your row if you're not in it, the leader marked with ★, and your row bold.
    - **Game over / win:** a "You won!" or "Game over" heading, your final %, kills and time survived, and a Play again button that returns to the start screen.
  - Responsive: the HUD must be readable at a 375 px width, and buttons must be ≥ 44 px tall.

- [ ] **Step 1:** Implement the effects and screens, and wire the state machine in `main.ts`: start → playing → over → start. The loop stops when the game ends.
- [ ] **Step 2:** Run `npm test` and `npm run build`. Expected: PASS and success.
- [ ] **Step 3:** Manual check in the browser at desktop size and at a 375×812 mobile viewport.
  - Capture shows the fill animation and the "+x.x%" text.
  - The leaderboard updates.
  - Dying shows game over, and Play again works.
  - There are no console errors.
- [ ] **Step 4:** Commit: `feat: capture juice, HUD, start and game-over screens`.
