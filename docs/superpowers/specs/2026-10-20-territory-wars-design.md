# Territory Wars — Design

**Date:** 2026-10-20
**Status:** Draft for approval

## Intent

The user loves Paper.io 2 and wants their own browser game that plays like it, called **Territory Wars**. The game's mechanics and tuning were studied from the user's APK with REA (see `docs/research/mechanics.md`). All code, art, names and text are written from scratch. Nothing from the original game (code, assets, name lists, branding) is copied.

## Goals

- A single-player web game in which you play against computer bots, offline in the browser.
- Works in mobile browsers (touch) and on desktop (mouse/keyboard).
- **Smooth controls** (user priority #1): steering eases toward the input direction and never snaps or jitters, at a steady 60 fps.
- **Satisfying capture** (user priority #2): closing a loop gives immediate, juicy feedback. The new land fills in with an animation, there's a small pop/scale and a floating "+x.x%" text, and the score ticks up.
- A clean pastel look: soft colours, slightly raised "3D-ish" blocks for territory and players, gentle shadows.

## Non-goals (for this version)

- Online multiplayer, accounts, servers.
- Ads, in-app purchases, coins economy, achievements, XP levels.
- Custom-shaped maps or multiple game modes.
- A native mobile app. The web app should be mobile-friendly, but it is not packaged for stores.

## Anti-goals (a failure even if it "works")

- Steering that feels laggy, twitchy or snaps to angles.
- A capture that just appears with no feedback.
- Anything that looks or reads like a copy of Paper.io 2's branding, skins or screens.
- Frame drops once many territories exist on screen.

## Gameplay rules (from the research, tuned for us)

Units below are world units; the arena radius is 100.

| Area | Rule |
|---|---|
| Arena | Circle, radius 100. The edge is a wall that is not lethal: position is clamped inside it. |
| Territory | Polygon-based (not a grid). Each player owns one or more polygons. |
| Start | Each player starts with a circle of land of radius 3. Spawn points are random, ≥20 u from the human and clear of others' land and trails. |
| Movement | Always moving forward at 10 u/s. The heading eases toward the target direction: `turn = min(dt, 0.04) × turnRate`, with turnRate 8 for the human and 4 for bots. |
| Trail | Leaving your land drops a trail point every 0.25 u. The segment you're currently on isn't dangerous to yourself. |
| Capture | When you re-enter your land, the area enclosed by your trail plus your land is added to your territory. Any enemy land inside it is removed from them. If an enemy's land is split, the enemy keeps the piece they're standing in. An enemy whose head ends up inside your new land dies. |
| Kills | Hitting another player's trail kills them. Hitting your own trail kills you. *(Our call: the kill is instant, not the original's "burning fuse". Instant is simpler and clearer. The fuse can be added later.)* Head-on body collision: *(our call)* the player with the larger territory survives. |
| Losing all land | *(Our call)* If a capture takes all of a player's land while they're out on their trail, that player dies at once. This applies to the human too, and it's a separate game-over path. |
| Trails inside captures | *(Our call)* An enemy trail inside the newly captured area stays live and deadly. Only land changes hands. |
| Death | The dead player's land shrinks away with an animation and becomes neutral. |
| Bots | 12 bots (13 players total). A dead bot respawns after a short delay with a new name from our own name list. *(Our call)* If no spawn point meets the rules, the bot waits and the spawn is retried every second. Late in a game, bots simply stop coming back. |
| Score | % = your area ÷ arena area × 100. Live leaderboard (top 5 + you) sorted by %, plus a kill counter. |
| End | You win when your % reaches 99.5 (*our call*: polygon float error and respawning bots make a literal 100% near-impossible; the original also wins at about 99.5% real coverage). When you die, the round ends: a game-over screen shows % and kills, with "Play again". No revive. |

## Bot behaviour

- **Expand loop:** pick a point on its own border, go out through 2 waypoints (3–15 u apart), then return to its border. Our call: bots steer directly toward waypoints and avoid walls and their own trail; there is no A* pathfinding unless direct steering proves bad.
- **Hunt:** if the human's trail is within about 10 u ahead or 15 u to the forward diagonals, chase it.
- **Caution (our addition, small):** if their trail gets long and the human is close, they head home early. This makes bots feel less suicidal.
- Difficulty is a few tunable constants in one config file.

## Presentation

- **Rendering:** HTML Canvas 2D. The camera follows the player and zooms out smoothly from a view half-height of 20 to 30 as the player's % grows.
- **Look:** a pastel palette (about 12 distinct player colours) on an off-white arena with a subtle grid pattern. Territory is drawn as a flat top plus a darker lower "lip" offset, to fake depth. Players are a rounded cube in a slightly darker shade. Trails are a lighter, semi-transparent ribbon.
- **Capture juice:** the new region fades and scales in over ~200 ms, with a floating "+x.x%" text, a brief camera nudge, and an optional soft sound and mobile vibration.
- **UI screens:** a start screen (title, name input, colour pick, Play), the HUD (%, kills, leaderboard), and a game-over screen.

## Controls

- **Touch / mouse:** drag anywhere. The direction from the touch-down point to the current finger position sets the target heading (a floating virtual joystick). Releasing keeps the current heading.
- **Keyboard:** arrow keys / WASD set the target heading (8 directions), with the same easing.

## How it gets made (builder's call unless noted)

- **Stack (my call, told to the user):** TypeScript + Vite, no game framework, Canvas 2D. It runs entirely client-side.
- **Main loop (my call):** a fixed-timestep simulation at 60 Hz, with rendering interpolated between ticks. Simulation state is plain serializable data. This keeps the smooth feel independent of frame rate and makes a future multiplayer server possible without rewriting the core. The turn formula uses the fixed tick dt.
- **Polygon operations:** use a well-tested MIT polygon boolean library (e.g. `polygon-clipping`) for union and difference rather than hand-rolling clipping. Capture = union(own land, polygon formed by the trail closed along own border), then subtract the result from every other player's land.
- **Structure:** keep the simulation (rules, bots) separate from rendering and input, so the simulation can be unit-tested headlessly and later reused by a multiplayer server.
- **Testing:** unit tests (Vitest) for capture, kill rules, area/% and spawn. Play-test manually in the browser, including at mobile viewport size.
- **Performance target:** 60 fps on a mid-range phone with 13 players. If polygon boolean operations get slow, simplify polygons and cache the rendered territory to an offscreen canvas.

## Left to the builder

File layout, exact colours, bot name list (original names), sound assets (generated or free-licensed), the exact easing curves, and the exact head-on collision tie-break.

## Housekeeping

- The APK stays local only and is added to `.gitignore`. It must never be committed.
