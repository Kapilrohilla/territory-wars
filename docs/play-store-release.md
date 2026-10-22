# Releasing Territory Wars on Google Play

The Android app is a Capacitor wrapper around the Vite build (`android/`).
Package name: `com.kapilrohilla.territorywars`. It can never change after the first upload.

## 1. One-time setup

### Upload key
Create it once, keep it **outside the repo**, and back it up (password manager plus an offline copy).
With Play App Signing, Google holds the real signing key. If you lose this upload key, Play support can reset it, but that takes days.

```bash
mkdir -p ~/keys && keytool -genkeypair -v -keystore ~/keys/territory-wars-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Then `cp android/keystore.properties.example android/keystore.properties` and fill in the
path, passwords and AdMob app id. That file and `*.jks` are gitignored.

### AdMob (real ads)
1. In the AdMob console, add an Android app, then create one **Rewarded** unit and one **Native advanced** unit.
2. Put the App ID (`ca-app-pub-…~…`) in `android/keystore.properties` as `admobAppId`.
3. Put the unit IDs (`ca-app-pub-…/…`) in a gitignored `.env.production.local` in the repo root:
   ```
   VITE_ADMOB_REWARDED_ID=ca-app-pub-XXXX/XXXX
   VITE_ADMOB_NATIVE_ID=ca-app-pub-XXXX/XXXX
   ```
   Without these, the build ships Google's test ads. Real users then see "Test Ad" banners and you earn nothing.
4. After the app is live on Play, link it in AdMob (App settings → link to store).
5. Host an `app-ads.txt` on your developer website. AdMob shows the exact line to use.

### Play Console
1. Register at https://play.google.com/console. The fee is a one-time $25, and identity verification is required.
2. **Personal accounts created after Nov 2023:** before you can publish to production, you must run a
   **closed test with at least 12 testers opted in for 14 consecutive days**. Plan for this.
3. Create the app: Game › Arcade › Free › "Contains ads: Yes".

## 2. Each release

1. Bump `versionCode` (it must always increase) and `versionName` in `android/app/build.gradle`.
2. Build:
   ```bash
   npm run android:sync
   cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew bundleRelease
   ```
   Output: `android/app/build/outputs/bundle/release/app-release.aab`. You can also use
   Android Studio › Build › Generate Signed Bundle.
3. Install it on a real phone and play a full round, including the revive ad and the results ad.
4. In Play Console › Testing › Closed testing (first release) or Production, upload the `.aab` and add release notes.

## 3. Store listing and policy forms (Play Console › App content)

| Item | Notes |
|---|---|
| Privacy policy URL | **Required** (the app uses AdMob, so it shares the advertising ID). Host a page, e.g. GitHub Pages. |
| Ads | Yes |
| Data safety | Declare: Device or other IDs (advertising ID), App activity, Diagnostics. Shared with Google AdMob for advertising. Encrypted in transit. |
| Advertising ID | Yes, used for advertising. The AdMob SDK adds the `AD_ID` permission automatically. |
| Content rating | IARC questionnaire. It matches the code's Teen ad cap; the game itself will likely rate Everyone / PEGI 3. |
| Target audience | 13+. Don't select under-13 ages, or the Families policy applies. |
| App icon | `assets/play-store-icon-512.png` (sources: `assets/*.svg`; `npm run android:assets` regenerates every Android size from `assets/*.png`) |
| Feature graphic | 1024×500 PNG |
| Screenshots | 2–8 phone screenshots, from your own game only |
| Short description | ≤ 80 chars |
| Full description | ≤ 4000 chars. Don't name other games (e.g. "Paper.io"); that breaks the impersonation/metadata policy. |
