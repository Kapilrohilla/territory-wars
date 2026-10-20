# Territory-capture reference game: mechanics notes

These notes describe the mechanics of the reference APK (Unity/Mono, `Assembly-CSharp.dll`), written in our own words for an original web game. They contain no code, art, or text from the game. Numbers are in Unity world units (u) and seconds.

**Evidence** (REA):
- `E0` = ev_1a8f4e44d677600785163c1e5957af5d6ed0f40d7de48ba196b8396e387b8528 (assembly type inventory)
- `E1` = ev_08188fdca9ebb675932079cb7f38ab475634ca71b8852a65fa7202ebc8561703 (gameplay types: Player, Zone, ZoneManager, GameManager, Playground, IA, MathUtils, UIManager …)
- `E2` = ev_3dcae27a2c7006c4b19f95a169cdded2218e4dea12375470bee581db0e8a4476 (coroutines: tail burn, respawn retry, game over)

I read method bodies as IL. I took the numeric literals from those bodies.

**Confidence labels**
- **O** = Observed in code.
- **I** = Inferred.
- **U** = Unknown, for example values serialized in scenes or assets, which I did not parse.

## 1. Arena
- **O** The arena is a **circle of radius 100 u**. This is the code default of `Playground.Radius` (E1). The playfield is a polygon with one vertex every 0.15 u of arc, so about 670 vertices. The value could be overridden in the scene (**U**). The game treats it as 100.
- **O** In "maps" mode, the arena is instead a **custom polygon** taken from per-level data (point list, player count, scale factor) (E1: LevelData).
- **O** Territory is **polygon-based, not grid-based**. Each territory is a vertex list. It is drawn by triangulating the polygon and measured by shoelace area (`MathUtils.GetPolygonSurface`, `MeshUtils.GetMeshArea`) (E1).
  - A grid exists only for the A* pathfinding library the bots use. It covers the arena bounding box with 1 u nodes.
- **O** The arena edge is **not lethal for the player**. Every frame the position is clamped to stay within `Radius` of the centre (E1: Player.Update).
  - Wall pieces tagged as a death collider line the edge. Bots raycast for them to steer away.
- **O** Area percentage = own polygon area ÷ arena area × 100, plus a 0.5-point bonus, capped at 100. It is shown with 2 decimals (E1: Playground.GetPercent, UIManager.UpdateScore).

## 2. Movement
- **O** Default speeds (E1: GameManager.SetSpeedValues). One of three presets is chosen by an A/B flag:

  | preset | player speed | bot speed | player turn rate | bot turn rate |
  |---|---|---|---|---|
  | normal | 10 u/s | 10 u/s | 8 | 4 |
  | "medium speed" | 12.5 u/s | 12.5 u/s | 8 | 6 |
  | "speed" | 15 u/s | 15 u/s | 8 | 8 |

- **O** **Input**: a virtual on-screen joystick (CnControls, axes Horizontal/Vertical). The stick direction is normalized and becomes the *target heading*.
  - With no input, the last direction is kept, so the player **never stops**.
- **O** **Turning is smoothed, not instant**. Each frame the heading moves toward the target by `t = min(dt, 0.04) × turnRate`, using quaternion lerp, which is exponential easing.
  - Turns are fast at 8 and visibly lazy at 4 for bots.
  - The player always moves forward along the current heading at `speed × min(dt, 0.04)`.
- **O** Bots steer the same way toward their current waypoint (E1: Player.Update).
- **O** Level/XP mode (A/B):
  - Turn rate lerps from base to base+1 for the player, or base+2 for bots, between level 1 and level 20.
  - Bot speed lerps from base to base+4.
  - Player speed is scaled by camera zoom ÷ minimum zoom.

## 3. Trail and capture
- **O** **Trail building**
  - While outside own territory, a trail segment (trigger collider plus line point) is dropped every **0.25 u**.
  - A sampled point is stored every **0.04 s**, or every 0.02 s for the newer cut algorithm (E1: Player.Update, Player ctor).
- **O** A new segment only becomes "armed" (`IsActive`) after the owner's body has left it. This prevents instant self-kills (E1: TrailCollider.OnTriggerExit).
- **O** **Closing the loop** (E1: Zone.DrawZone, Zone.GenerateZoneMesh).
  1. When the player re-enters own territory, the vertex nearest the exit point and the vertex nearest the entry point are found.
  2. Two candidate polygons are built. Each replaces one of the two boundary arcs between those vertices with the trail.
  3. The candidate with the **larger area** is kept.
  4. Vertices closer than 0.3 u, or further apart than 5 u, are removed as cleanup.
  - Result: plain polygon splicing. No flood fill and no clipping library.
- **O** **Enemy territory** (E1: Player.DrawShape, Zone.CutZone, Zone.CutZoneNew, Zone.GetZoneToKeep).
  - Every enemy zone the trail *passed through* during the excursion is cut by the new shape.
  - The cut removes the overlapped part. If the enemy zone splits, the piece that contains (or is nearest) its owner survives.
  - Enemy zones that the trail fully enclosed without entering are found but apparently not acted on in the old algorithm (**I**).
  - In the newer cut algorithm (A/B flag), an enemy whose head and exit point lie inside the new territory is **killed** ("overwhelmed").
- **I** Percentages are recomputed for the capturer and every cut owner after each capture (E1: Player.SetPercent calls in CutZone).

## 4. Kill rules
- **O** **Trail cut** (E1: Player.OnTriggerEnter, Player.Hit; E2: BurnTail).
  - When a player's body touches any armed trail segment, the *trail owner* is hit and the toucher is credited as the killer.
  - The hit does not kill instantly. The trail splits at the hit point and **burns away like a fuse in both directions**, removing 4 line points per 60 fps-frame, or 2 with the "slow tail burn" flag. That is about 60 u/s, or 30 u/s.
  - When the burn reaches the owner's head, the owner dies.
  - If the owner gets back into own territory first, the burn is cancelled and the player **survives** (E1: Player.OnZoneEnter clears the burning state).
- **O** **Self-trail**: touching your own armed trail hits you the same way, and you are your own killer.
  - With the anti-suicide flag, it instead cuts off the looped part of your trail and you live (E1: Player.AntiSuicideTrailRecalculation).
- **U** **Head-on body collisions**: no player-vs-player body handler was found. They probably pass through each other.
- **O** **Out of bounds**: impossible, because position is clamped to the arena circle (see 1).
- **O** **Dead player's territory** (E1: Zone.Die, Player.Die).
  - The zone is deregistered, plays a short shrink/fade (~0.22–1 s), and is destroyed. The land becomes neutral.
  - Players standing in it are force-exited.
  - The killer's kill count +1. Kill feedback text escalates with the streak count (1, 2, 3, 4+).

## 5. Starting territory
- **O** A **circle of radius 3 u** around the spawn point, with a vertex every 0.08 u of arc (about 236 vertices) (E1: ZoneManager.SpawnPlayer, Zone.Start).
- **O** Spawn point (E1: Playground.GetAvailablePosition, ZoneManager.GetAvailablePosition, E2 RetrySpawn).
  - A random point inside the arena polygon is chosen, with up to 100 tries.
  - It is rejected if it is within 20 u of the human, if any zone, trail or edge collider is within 3 u, or if it lies inside an existing zone.
  - On failure, the spawn is retried after 0.025 s.

## 6. Bots
- **O** **Count** (E1: GameManager.SpawnBotIfNecessary).
  - `NbPlayers = 14` by default. Every frame, a bot is spawned while total players < NbPlayers−1, so about **13 players including you**.
  - Bots that die are **replaced immediately**.
  - In maps mode the count comes from the level data.
- **O** **Names**: a random pick from a built-in comma-separated list of about 1,600 first names (about 1,200 for the Chinese locale). Duplicates are possible. The human uses a saved nickname.
- **O** **Behaviour states** (E1: IA.*).
  - **Expand loop**:
    1. Pick a random vertex of its own territory.
    2. Pick two "world" points, each offset 3–15 u diagonally in random quadrants, each from the previous point.
    3. Pick another own-territory vertex.
    4. Visit the four points as a loop, out and back home.
  - Waypoints count as reached within 2 u. Paths come from A* over a 1 u grid, and trail segments are fed into the grid as obstacles.
  - On re-entering home, a new loop is chosen.
  - **Hunt**: each frame the bot raycasts 10 u ahead and 15 u along both forward diagonals. If a ray hits the **human's** trail (bots never target other bots), it paths straight to that point.
  - **Avoid edge**: when the forward ray hits the arena wall, the bot raycasts 50 u diagonally. It turns away from the side with walls or its own trail, then heads home. Detection pauses for 0.25 s.
  - **Flee / return-when-threatened**: no such state exists (**O**, absent). Bots only head home as the last leg of each loop.
- **O** **Difficulty knobs**: bot turn rate (4 / 6 / 8), speed preset, wander distance 3–15 u, hunt ray lengths 10 / 15 u. In XP mode, bots start with 0–250 random XP.

## 7. Scoring, UI and flow
- **O** **HUD**:
  - Own % with 2 decimals.
  - A "best" progress bar.
  - Kill counter.
  - Floating "+x.xx%" feedback after each capture.
  - A live **leaderboard** sorted by % descending, using a fixed number of rows from the scene (**U**, likely 5). It shows your own row if you are outside the top.
  - A **crown** on the #1 player (E1: UIManager.UpdateRanking, ZoneManager.GetSortedPlayerList).
- **O** **Camera**: orthographic half-height = 20 + 30 × (own % / 100), capped at 30. The new-zoom flag uses 15/20 instead. It zooms out as you grow (E1: GameManager.AdaptCamera).
- **O** **Win**: own % reaches 100, which with the 0.5 bonus means about 99.5% real coverage. A victory effect plays, then the game-over screen after 2 s (E1: Player.SetPercent, WinFinish).
- **O** **Lose**: your death leads to the game-over screen after about 0.5–1 s.
  - **One continue per round**: if a rewarded video is watched, you revive at a random point inside your *remaining* territory with your land intact. If none is left, you get a fresh spawn.
  - Otherwise the round ends; there is no automatic respawn for the human.
- **O** **Rewards**: score is kept as a % best (per level in maps mode). Coins = round(% × 10) + 10 per kill. Game-over analytics report score (% × 100) and kills.

## 8. Other features (brief)
- **O** Remote **A/B flags** decide many rules (FeatureManager/AbstractFeature, chosen by analytics cohort). Which are on by default is stored in the scene (**U**). The flags are:
  - speed presets
  - slow tail burn
  - anti-suicide
  - new cut algorithm
  - XP / "growing player" levels from kills or area
  - crown on/off
  - new zoom
  - maps / levels with unlocks
  - skins (coins or achievements)
  - "pokedex" collection screen
  - low-FPS mode
  - feedback popups
- **O** Other features:
  - Skins with a carousel, unlock by coins or achievements.
  - Achievements: kill X players, kill the king, multikill, % on a map, consecutive days, time outside zone, revive.
  - Haptics.
  - Localization.
  - Ads with a rewarded-video revive.
  - End-of-game territory screenshot.
