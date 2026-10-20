# Territory Wars — Mobile Designs v2 (13+, ads only, no payments)

Stitch project **"Territory Wars – Mobile App"** (`projects/15742747269775202406`). On the canvas, v1 sits
at the top, and v2 sits below its own design-system card **"Territory Wars v2 (13+, ads-only)"**
(`assets/13596528010929241168`).

## What changed from v1
- **Audience 13+:** not a Families-program app. Set the AdMob max ad content rating to **T**, and use
  Google UMP for consent (EEA/UK).
- **No payments:** v1's Remove Ads ₹199, VIP pass, "No Ads" crown and coin "+" buttons are gone. Coins are only
  earned by playing or by watching optional rewarded ads.
- **New game features designed in:** Easy/Normal/Hard difficulty, best score per difficulty, burning trail
  (embers and a "get home" warning), one revive per round with a 5 s countdown and a 2 s shield, the minimap,
  and the Home button.

## Palette (v1 base, contrast fixed)
| Token | Hex | Note |
|---|---|---|
| paper / arena / card | `#E4E2DC` / `#F8F7F3` / `#FFFFFF` | unchanged |
| ink | `#34323F` | **all** text, including on coloured buttons (white on periwinkle was only 2.3:1) |
| ink-muted | `#5E5B6B` | replaces `#6C6A78`, which was only 4.1:1 on paper |
| primary periwinkle / lip | `#8DAAEC` / `#5B78C9` | ink on periwinkle 5.4:1 |
| reward gold | `#FFC93C` | coins, best score, new best (ink 8.2:1) |
| revive green | `#2ED47A` | revive and rewarded-ad buttons (ink 6.5:1) |
| burn ember | `#FF7A59` → `#FFB347` glow | burning trail; danger pill `#FFE1E1` / `#B4232F` |
| shield cyan | `#6CC3EF` | 2 s post-revive protection |
| player hues | `hsl(h,78%,70%)`, lip `hsl(h,45%,54%)` | slightly bolder than v1's `72%/74%` |

## Screens
| File | Screen | Ads |
|---|---|---|
| `01-home.png` | Home: best per difficulty, name, colour, difficulty, Play | anchored banner |
| `02-hud.png` | In-game HUD: rival trail burning, minimap | none |
| `03-hud-burning.png` | Your trail is burning: get home | none |
| `04-revive.png` | Knocked out: 5 s ring, cause line | rewarded (revive) |
| `05-revived-shield.png` | Revived with a 2 s shield | none |
| `06-results.png` | Results: difficulty tag, new best, Home | rewarded (double coins), native |
| `07-skins.png` | Skins: coins, ad unlocks, achievement unlocks | rewarded, banner |
| `08-records-settings.png` | Bests per difficulty, settings, privacy & ads | none |

Known issues in the exported PNGs (fix requests were sent to Stitch, but these exports still show the old versions):
- `02/05`: they show a joystick and a "Lv.4" label, which the game doesn't have.
- `03`: the "Drag to steer" text overlaps the "HOME!" label.
- `07`: the unlock text overlaps the skin names on locked cards.
- `08`: the tab labels read Arena/Ranks instead of Play/Records.
