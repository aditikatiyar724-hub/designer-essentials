# Designer Essentials

A catch-the-falling-kit game built from the `perks-sample-aditi` Figma frame, running on two
runtimes: a static web build and an Expo app you can open in Expo Go.

```
Index.html            web entry — open it directly, no server needed
assets/
  game.css            web stylesheet (tier 3 component tokens + rules)
  game.js             web game loop (DOM sprites, requestAnimationFrame)
  tokens.css          GENERATED — do not edit
  game-config.js      GENERATED — do not edit
  img/                the 14 sprites exported from Figma
tokens/
  tokens.json         design tokens — the single source of truth
  game.json           gameplay config — scoring, pacing, the item table
  build.mjs           generator: emits the four files marked GENERATED
mobile/               Expo app (React Native)
  App.tsx             fonts, splash gate, gesture root
  src/Game.tsx        the game surface and the UI-thread frame loop
  src/engine.ts       sprite pool, collision geometry, item weighting
  src/components/     Hud, StartScreen, GameOverScreen, Sprite, Lockup, buttons
  src/theme.ts        GENERATED — do not edit
  src/gameConfig.ts   GENERATED — do not edit
  assets/img/         copy of the sprites, so Metro can bundle them
```

## Running it

**Web** — open `Index.html` in a browser. Nothing to install.

**Phone (Expo Go)**

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with Expo Go. The project targets **Expo SDK 57**, so the Expo Go on your phone
must be the SDK 57 build. Phone and laptop need to be on the same network; if the QR code will not
connect, `npx expo start --tunnel`.

## Changing anything shared

Colours, spacing, type, shadows, stage geometry → `tokens/tokens.json`.
Scoring, timing, fall speed, the item table → `tokens/game.json`.

Then regenerate both platforms:

```bash
node tokens/build.mjs
```

That rewrites `assets/tokens.css`, `assets/game-config.js`, `mobile/src/theme.ts` and
`mobile/src/gameConfig.ts`. Never hand-edit those four — the next build overwrites them. A value
that exists in only one runtime is a bug waiting to happen; put it in the token files instead.

Adding a sprite means dropping the PNG into **both** `assets/img/` and `mobile/assets/img/` and
adding a row to the `items` array in `tokens/game.json`. Give it explicit `width`/`height` — the
artwork has mixed aspect ratios, and a shared size squashes it.

## How the two implementations differ, and why

The design language is shared; the rendering is not. Same component names, same props, same token
references, separate code.

| | Web | Native |
|---|---|---|
| Loop | `requestAnimationFrame` on the main thread | Reanimated `useFrameCallback` worklet on the UI thread |
| Sprites | pooled DOM `<img>`, CSS transforms | pooled Reanimated views, shared values |
| Input | pointer events on the stage | `react-native-gesture-handler` pan |
| Feedback | WebAudio blips | haptics (`expo-haptics`) |
| Persistence | `localStorage` | `AsyncStorage` |
| Shadows | `box-shadow` / `drop-shadow` | iOS `shadow*`; skipped on Android for cut-out art, where `elevation` would draw a rectangle behind a transparent PNG |
| Game-over scrim | backdrop blur | flat scrim — no cheap blur on Android |

Both scale the same 360×800 Figma frame to fit, letterboxed. Nothing inside the frame reflows, so
the layout is identical at every screen size.

## Gameplay

60 seconds. Basics score 10–30 by tier; **coffee** adds 3 seconds, **cash** is worth 50, and
**Pinterest** doubles everything for 6 seconds. Five consecutive catches raise the multiplier, up
to ×4; dropping one resets the streak. Backing out with the ← button abandons the round and records
nothing.
