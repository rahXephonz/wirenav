# Preview rendering (definePreview + snapshot providers)

Goal: compose-nav-graph-style screen thumbnails in the graph. The fidelity bar is
**recognition, not pixel-perfection** — a human looking at the graph should recognize the
screen. compose-nav-graph itself falls back to a param card when a screen isn't
previewable (see its SingleLicenseScreen behavior); wirenav does the same. A screen
without a snapshot is normal output, not an error state.

## Layering (must hold)

```
extractors ──► IR ──────────────────────────► render-html
                │                                  ▲
                └──► snapshot provider ──► SnapshotMap { destinationId → { path, width, height, status } }
```

- Core and extractors never import rendering code.
- render-html accepts an OPTIONAL SnapshotMap. Missing/empty map or missing entry ⇒
  param card. render-html must be release-quality with zero snapshots.
- Providers are swappable behind one interface: `snap-web` (default), `snap-device`
  (future, emulator-based), `--images <dir>` (manual: files named by destination id).
- SnapshotMap entries carry `status: 'ok' | 'crashed' | 'skipped'` + optional diagnostic,
  so render-html can show WHY a card is a fallback.

## The definePreview convention (@wirenav/preview)

RN screens are not self-contained: they need params, navigation context, and providers.
The `.preview.tsx` sibling file supplies them:

```tsx
// app/user/[userId].preview.tsx
import { definePreview } from '@wirenav/preview';
import Screen from './[userId]';

export default definePreview(Screen, {
  params: { userId: 'demo-123' },          // fixture values for required params
  wrap: (c) => <AppProviders mock>{c}</AppProviders>,  // optional provider wrapper
  viewport: 'iphone-15',                    // optional, defaults to CLI --device
});
```

Resolution order per destination:
1. `.preview.tsx` sibling exists → use it (authoritative).
2. No preview file, screen has no required params → attempt bare mount inside the
   default mock shell (mock NavigationContainer/router context + SafeArea).
3. Required params without fixtures, or mount throws → `status: crashed|skipped`,
   param card fallback, diagnostic WN401 (missing preview fixtures) / WN402 (mount crash,
   include the error message + component stack in the diagnostic).

The `params` object is also cross-checked against the IR's extracted param types —
a preview file with wrong param shape is diagnostic WN403 (it means either the preview
or the extractor is wrong; both are bugs worth surfacing).

## snap-web provider (v0.1 MVP contract)

Mechanism: bundle each screen entry with react-native-web aliasing (reuse the project's
metro/babel config where possible), serve statically, mount in headless Chromium via
Playwright at the device viewport, screenshot after fonts settle + one rAF, save PNG.

Hard scope limits for v0.1 — do not exceed them:
- ONE viewport per run (CLI `--device`, default 393×852 @3x logical iPhone-ish).
- Mock registry is a FIXED list: react-native-reanimated, react-native-gesture-handler,
  react-native-safe-area-context, react-native-svg, expo-image. Each mock is the minimal
  render-through implementation (Jest-preset style). Users can extend via
  `wirenav.config.ts > snapWeb.mocks`, but WE do not chase additional libraries in v0.1.
- Any screen that crashes: capture error → diagnostic → fallback card → CONTINUE. No
  retries, no per-screen timeout tuning, no rescue effort. Fixed mount timeout (5s).
- No custom fonts, no dark mode, no per-screen device overrides (v0.2).
- Parallelism: one Chromium, N pages (default 4). Determinism of IMAGES is not required
  (anti-aliasing noise is fine) — snapshots are NOT part of the .nav contract and never
  affect navCheck.

Known, accepted fidelity gaps (document in README, don't fight them): native stack
headers render as the JS fallback, platform fonts differ, native-only components show
mock placeholders. The answer to "previews look slightly off" is the future snap-device
provider, not heroics in snap-web.

## Testing

- @wirenav/preview: unit tests (resolution order, param cross-check).
- snap-web: fixture app with ~6 screens covering: bare-mountable screen, screen with
  .preview.tsx, screen with missing fixtures (WN401), screen that throws on mount
  (WN402), screen using a mocked lib (reanimated), screen using an unmocked native lib
  (fallback). Assert on SnapshotMap statuses + diagnostics, and that PNGs exist and are
  non-empty for 'ok' entries. Do NOT pixel-compare images in CI.
