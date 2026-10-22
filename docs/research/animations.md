# Territory-capture reference game: animation and feedback notes

These notes cover the animation, tween and feedback timings of the reference APK (Unity/Mono, `Assembly-CSharp.dll`, which uses the DOTween library). Like [mechanics.md](mechanics.md), they are written in our own words for an original web game and contain no code, art or text from the game. Units are Unity world units (u) and seconds. Easing names are DOTween's; where none is set, DOTween's default applies (OutQuad).

**Evidence** (REA, `inspect_managed_members` on Assembly-CSharp.dll, sha256 `83302354…c6a3`, MVID `80371965-0ca2-4736-91b3-ff448373e131`):
- `A0` = ev_c8a7b12065a2b1285f5305c4a99e2521804e1c9091bdd67249a8262c3554f387 (all types, method bodies, call edges, CIL constants)
- `A1` = ev_3e9fd04bdbf6d272f58267f9a51c0781489ca0c0c7f7436beaf44a2f379388dd (summary view of A0)

I found the animation sites by listing every game method that calls DOTween, Animator or ParticleSystem APIs. Then I read the float/int constants that feed each tween call.

**Confidence labels**: **O** = constant observed in the method body. **I** = inferred from call order or argument position. **U** = set in scene or prefab data, which I did not parse.

## 1. Player spawn: drop and squash ("StartAnim")
- **O** The head starts 15 u *above* the board (z = −15 in Unity's top-down camera), then drops to the surface in **0.25 s**.
- **O** Next comes a three-step squash and stretch, **0.1 s per step**:
  1. Scale (1.2, 1.2, 0.5): wide and flat on landing.
  2. Scale (0.8, 0.8, 2): thin and tall on rebound.
  3. Scale (1, 1, 1): settles.
- **O** A callback after the drop shows the start-zone shadow. A final callback marks the player as started and turns on camera follow.
- **I** Total about 0.55 s. The player can't move until it finishes.

## 2. Capturing land ("Zone.CreatedAnim")
- **O** The newly captured piece is drawn as a separate mesh. It starts **1 u below** the board surface and rises to −0.05 u (just above it) in **0.35 s**.
- **O** At the same time its colour tweens from the zone's *shadow* (darker) colour to its *main* colour over **0.5 s**.
- **O** After 0.5 s the temporary mesh is hidden and the real zone mesh shows. The land "grows up out of the floor while brightening".
- **O** Juice that plays alongside a capture:
  - A haptic tick on re-entering own land (`OnZoneEnter`).
  - A particle burst in the zone's shadow colour (`InZoneFX`).
  - A "+x.xx%" popup (see §6).

## 3. Zone death ("Zone.Die")
- **O** The colour tweens to the shadow colour in **0.22 s**.
- **O** At the same time the zone mesh **sinks 1 u** into the floor over **0.25 s**. Its drop-shadow mesh flattens (local z → 0) over 0.25 s.
- **O** The zone is destroyed when the sink finishes. Players standing in it are force-exited.
- Compare with the clone: ours scales toward the centroid and fades over 0.5 s. The original *sinks and darkens*, with no shrink, in half the time.

## 4. Player death ("Player.DestroyFX")
- **O** A pooled particle burst is placed at the head and scaled to the player's size.
- **O** Particles use the **player's colour**, with an alpha gradient of 1 → 0.5 → 0 over their lifetime.
- **O** Particle material colour is set to the player colour as well.
- **O** Death of the human: the revive panel opens **1 s** later (`DelayedShowRVPanel`).
- **O** Being hit (trail cut) vibrates the phone, both for the human being hit and when the human hits someone.

## 5. Camera
- **O** Follow is a per-frame lerp toward target + offset (`FollowTarget.LateUpdate`). The rate is a scene value (**U**).
  - There is an optional mode that smooths rotation with a 0.5 s quaternion tween (likely off for the main camera, **U**).
- **O** Zoom changes are **0.5 s tweens** of the orthographic size, not continuous lerps (`AdaptCamera`, `OnPlayerSpawned`).
  - The background quad scales with zoom (4.5 × zoom / 20) over the same 0.5 s, so the floor pattern never shows an edge.
- **O** On spawn the camera tweens to the player over **0.5 s**.
- **O** There is **no screen shake**: no shake calls exist in the game assembly.

## 6. Floating feedback text ("VisualFeedback", "UIManager.PlayFeedback")
- **O** Each popup is a UI text that:
  - rises to its target Y over **1.5 s**,
  - fades from opaque to 0 over **1.5 s** at the same time,
  - then destroys itself.
- **O** **Stacking**: when a new popup appears, every live popup has its target Y raised by **25 px** and slides there in **0.15 s**. Popups never overlap.
- **O** Hide (forced clear): slide to Y = 350 in 0.3 s, then destroy.
- **O** Kill feedback text escalates with the killer's kill count, coloured with the **victim's zone colour**:
  - 1 → "Kill!"
  - 2 → "Double kill!"
  - 3 → "Triple kill!"
  - 4+ → "Serial killer!"
- **O** Level/XP mode adds a delayed "Size Up!" popup **0.5 s** after a level-up.

## 7. HUD and menus
- **O** **Score**: text updates instantly (2 decimals).
  - The "best" bar fills over **0.2 s**.
  - The score label slides horizontally with the bar (0.2 s).
- **O** **Game over**: the score text and its shadow start at scale 0.25 and pop to scale 1.5 in **0.35 s with OutBack** (overshoot). Return home is automatic after 5 s.
- **O** **Revive panel**: scales from 0 to 1 in **0.3 s, OutBack**. Its buttons are not clickable until the pop finishes.
- **O** **Leaderboard shadow**: the rank-row shadow fades between alpha 0 and 0.14 instantly as rows toggle.
- **O** **Level progress ring** (XP mode): fills to 1 in 0.15 s, resets, then fills to the new value in 0.15–0.3 s.
- **O** **Level-up** (XP mode): the head, crown and name label scale up by +0.1 per level over **0.3 s**. The camera re-zooms.

## 8. Trail
- **O** A new trail collider segment is placed every 0.25 u (see mechanics §3). It is coloured with the zone shadow colour.
- **O** On a hit, the trail line is split into two line renderers and burned away from the hit point (mechanics §4).
- **I** The trail segment gets a DOScaleY call at creation. Its arguments look like a zero-duration set, not a visible grow.

## 9. Summary: animation timings to copy

| Moment | Original | Clone (after this pass) |
|---|---|---|
| Spawn | drop 0.25 s + squash 1.2/0.5 → 0.8/2 → 1 (3 × 0.1 s) | drop 4 u in 0.25 s with ground shadow, squash 1.25/0.75 → 0.85/1.2 → 1 (3 × 0.1 s); start land rises. Also on respawn and revive |
| Capture | rise from below 0.35 s + shadow→main colour 0.5 s | same timings (rises 0.7 u, lip→base shade) |
| Zone death | darken 0.22 s + sink 0.25 s | darken 0.22 s, sink 0.9 u and fade over 0.35 s |
| Player death | colour particle burst (alpha 1→0.5→0) | 33 spinning chunks in base and lip colours, same alpha curve; once per life (a down then a give-up bursts once) |
| Rival trail cut | vibration | sparks + flash (kept) |
| Re-enter own land | haptic + shadow-colour particle burst | lip-colour chunk burst on every capture; human also gets haptic + camera nudge |
| Popups | rise + fade 1.5 s, stack by 25 px (0.15 s slide) | 1.2 s, overshoot pop-in, stack by 26 px with a ~0.15 s slide |
| Kill streak text | 4 escalating callouts | our own wording: Takedown / Double / Triple / "Unstoppable ×n", victim colour, stronger nudge + 30 ms buzz |
| Zoom | 0.5 s tween per change | exponential, rate raised 3 → 5 (settles in ~0.5 s) |
| Modal pops | OutBack 0.3–0.35 s; revive buttons locked until the pop ends | overshooting CSS pops; revive card ignores taps for 350 ms |

Reduced motion (OS setting or the in-game toggle) skips the spawn drop and squash.
