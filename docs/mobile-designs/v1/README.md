# Territory Wars — Mobile App Designs

Generated in Stitch: project **"Territory Wars – Mobile App"** (`projects/15742747269775202406`),
design system **"Territory Wars Pastel"** (`assets/4768513027981398675`) — Rubik / Nunito Sans,
periwinkle `#94AEEE` primary, warm paper `#E4E2DC` neutral, chunky lip-shadow buttons, matching
`src/ui/style.css` and `src/game/palette.ts`.

| # | Screen | File | Ad units |
|---|--------|------|----------|
| 1 | Home / Start | `01-start.png` | Anchored adaptive banner (bottom) |
| 2 | In-game HUD | `02-hud.png` | **None** (deliberately ad-free) |
| 3 | Knocked out / Revive | `03-revive.png` | Rewarded — "Revive, keep your land" |
| 4 | Victory / Results | `04-results.png` | Rewarded — "Double coins"; native ad card; interstitial *before* this screen |
| 5 | Skins & Shop | `05-skins.png` | Rewarded — unlock skin, +1 spin; banner; "Remove Ads ₹199" IAP |
| 6 | Leaderboard & Profile | `06-leaderboard.png` | Native in-feed row after rank 10 |

## Where to place Google ads

Ordered by expected revenue for a casual .io game. In this genre, rewarded and interstitial ads
bring in most of the money; banners add a little.

1. **Rewarded: Revive after knock-out** (screen 3). This is usually the best-earning slot because
   the player has a strong reason to watch. Allow one revive per match, show a 5-second
   countdown, and always include a visible "No thanks".
2. **Rewarded: Double coins** (screen 4). Shown on every results screen and always optional.
3. **Interstitial: between matches.** Show it when the player taps *Play again* or returns to
   *Home*, never while a match is running. Add a frequency cap (for example, at most one every
   2 matches or 90 seconds) and skip it for each player's first 2–3 matches.
4. **Rewarded: Shop unlocks / extra spin** (screen 5). Lets players earn skins by watching ads,
   which also keeps them coming back.
5. **Native advanced: Results card + leaderboard row** (screens 4, 6). These are styled like the
   app but always labelled "Sponsored" and show the AdChoices icon.
6. **Anchored adaptive banner: Home + Shop** (screens 1, 5). It only appears on menu screens.
7. **App open ad (optional):** on cold start only, never on resume during a match.

**Never put ads on the in-game HUD (screen 2).** The whole screen is the drag-to-steer area, so
an accidental tap on an ad there would count as invalid traffic and could get the AdMob account
suspended. A banner covering the arena also hurts gameplay.

### Policy / implementation notes

- **Web build vs app:** AdMob only works in a native app. To ship this Vite build to the stores,
  wrap it with Capacitor and use `@capacitor-community/admob`. For the browser version, use
  **AdSense H5 Games Ads (Ad Placement API)**, which supports interstitial (`adBreak` type
  `next`) and rewarded (`type: 'reward'`) ads for HTML5 games.
- Keep at least ~32px of space between ads and buttons. On the Results screen the native card
  sits close to *Arena Lobby*, so add more spacing when you build it.
- Ask for consent before showing ads: Google UMP SDK for GDPR, plus ATT on iOS.
- Pause the game loop and mute `src/game/sound.ts` while any full-screen ad is showing.
- The **Remove Ads** purchase should turn off banners, interstitials and native ads but **keep
  rewarded ads**, since players choose to watch those.
- Use Google's test ad unit IDs during development.
