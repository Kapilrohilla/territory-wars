# Territory Wars

Loop out, come home, claim the map. A fast arcade territory-capture game for the browser and Android: leave your land to draw a trail, curve back home to capture everything inside, and outsmart rival bots before they cut your trail.

**Play in the browser:** https://kapilrohilla.github.io/territory-wars/

![Gameplay](assets/store/screenshot-1.png)

## Features

- One-finger steering, quick offline rounds
- Easy, Normal and Hard rival bots
- Live leaderboard and minimap
- 11 unlockable skins, personal bests and career stats
- Android build via Capacitor, with AdMob revives and skin unlocks

## Tech

TypeScript + Vite, rendered on canvas, with no game framework. Vitest for tests, Capacitor for Android.

## Development

```bash
npm install
npm run dev          # local dev server
npm test             # run tests
npm run build        # type-check and build to dist/
npm run android:run  # build, sync and run on a device/emulator
```

Pushes to `main` deploy the web build and the [privacy policy](privacy/index.html) to GitHub Pages.

## Docs

- [Play Store listing copy](docs/store-listing.md)
- [Play Store release notes](docs/play-store-release.md)
