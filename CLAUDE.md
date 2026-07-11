# wirenav

Static analysis toolkit that extracts, visualizes, and diff-checks React Native navigation
graphs — Expo Router & React Navigation. Inspired by skydoves/compose-nav-graph, rebuilt
around the constraints of the RN ecosystem (no KSP, no headless renderer).

## Core thesis

The navigation structure of an RN app is recoverable **statically** — from the filesystem
(Expo Router) or the TypeScript AST + type checker (React Navigation) — without ever running
the app. wirenav extracts that structure into a neutral IR, serializes it to a deterministic
`.nav` text file that lives in the repo, and fails CI when the navigation surface drifts
from the committed baseline. Visualization is a *consumer* of the IR, never the core.

## Architecture: IR-first (non-negotiable)

```
Expo Router files ──┐
                    ├──► Graph IR ──► .nav serializer ──► navCheck differ
React Navigation ───┘        │
     TS AST                  └──► HTML canvas export ──► (future: VS Code webview)
```

Extractors produce IR. Renderers/differs consume IR. **Nothing downstream may import from
an extractor package.** N extractors × M outputs must stay N + M, not N×M. Adding a third
router (e.g. wix/react-native-navigation) must touch zero downstream code.

## Monorepo layout (pnpm workspaces)

```
packages/
  core/                     @wirenav/core        — IR types, .nav serializer, differ. ZERO deps on extractors.
  extract-expo-router/      @wirenav/extract-expo-router
  extract-react-navigation/ @wirenav/extract-react-navigation
  preview/                  @wirenav/preview     — definePreview() convention (params fixtures, provider wrap)
  snap-web/                 @wirenav/snap-web    — RN-web + Playwright snapshot provider (produces SnapshotMap)
  render-html/              @wirenav/render-html — consumes IR + optional SnapshotMap
  cli/                      wirenav              — detect router → extract → [snapshot] → dump | check | render
apps/
  example-latest/           — full Expo TS app on the LATEST SDK. Dogfood target, snap-web
                              CI target, source of the README demo GIF. This is a real
                              installed app (own node_modules via workspace).
  example-legacy/           — full Expo TS app pinned to an OLDER supported SDK (extraction
                              smoke test only; EXCLUDED from snap-web CI to keep CI sane).
fixtures/                   — SOURCE-ONLY miniature apps (no node_modules, never installed).
  expo-router-v3/ ...          Each declares router/SDK version in its package.json so the
  expo-router-latest/ ...      extractor's version detection is itself under test.
  react-navigation-v6-dynamic/
  react-navigation-v7-static/
```

Key distinction: **fixtures are never installed** — extractors are static analyzers and
must work from source + package.json alone. Full installed apps exist only where runtime
is genuinely needed (snap-web, dogfooding). Do not add more installed apps to cover
extractor version differences; add source-only fixtures instead.

## Version support policy

Declared support matrix (README + enforced by fixtures):
- **Expo Router**: v3+ (SDK 50+). Older = error with guidance, not silent wrong output.
- **React Navigation**: v6 (dynamic JSX only) and v7+ (static API + dynamic).

How version differences are handled:
1. Extractors read the target's `package.json` (declared dependency versions) and select a
   **version profile** — a small strategy object encoding convention differences (e.g.
   which special files exist, whether typed routes/static API are available). Profiles
   live in each extractor under `src/profiles/`; convention differences are data in the
   profile, not `if (version)` branches scattered through extraction logic.
2. The resolved profile/version is recorded in the IR and printed in the `.nav` header
   (`router: expo-router@5` style) — version misdetection must be visible in diffs.
3. Unknown/newer-than-known version: fall back to the latest profile + diagnostic WN104
   (unrecognized router version, best-effort extraction) — never hard-fail on a version
   bump alone.
4. Every profile has at least one source-only fixture exercising its distinctive
   conventions. Adding version support = adding a profile + its fixtures + goldens.

## The split is by ROUTER, not by toolchain

"RN CLI vs Expo" is the wrong axis. Expo apps can use plain React Navigation; Expo Router
only exists inside Expo. The two extractors are:

- **extract-expo-router** — filesystem conventions are the graph. Edges from `<Link href>`
  and `router.push/replace/navigate` path literals.
- **extract-react-navigation** — covers RN CLI *and* Expo-without-Router. Three tiers of
  confidence: (1) v7 static API → clean AST extraction, (2) dynamic JSX `<Stack.Screen>` →
  best-effort heuristics with **documented failure modes**, (3) edges → explicit
  `defineNavEdge()` markers are the reliability guarantee; call-site inference of
  `navigation.navigate('X')` is supplemental sugar, never the foundation.

## Invariants (violating any of these is a bug, not a style choice)

1. **Deterministic `.nav` output.** Same input tree ⇒ byte-identical file. Sorted
   destinations, canonical param serialization, no timestamps, no absolute paths, LF line
   endings. The `.nav` file is the public API contract — design changes to it require a
   schema version bump (`wirenav-format: N` header).
2. **Every edge carries provenance**: `kind: 'declared' | 'inferred'` plus source location.
   Inferred edges may be wrong; the differ and renderer must be able to distinguish them.
3. **Honest coverage.** When an extractor cannot resolve something (dynamic route name,
   spread config, `.map()` over screens), it emits a `diagnostics` entry with file/line —
   it never silently drops or silently guesses.
4. **Core stays runtime-free.** No React, no react-native, no Expo imports anywhere in
   `@wirenav/core`. It must run in any Node ≥ 20 environment including CI.

## Previews: recognition aid, not design review

Screen previews ARE in scope (v0.1) via a pluggable snapshot layer — but the fidelity bar
is compose-nav-graph's, not pixel-perfection: previews exist so a human recognizes the
screen in the graph. Screens without a resolvable preview fall back to a param card
(destination name + typed params), exactly like compose-nav-graph does for
non-previewable screens. See `.claude/skills/wirenav-dev/references/preview-rendering.md`.

Architecture rule: snapshots are a SnapshotMap { destinationId → image } produced by a
provider package and handed to render-html. Core and extractors know nothing about
rendering. Providers are swappable: snap-web (default), snap-device (future),
--images dir (manual).

## Scope guardrails — do NOT build these (v1)

- ❌ Pixel-perfect / on-device rendering (snap-device with Maestro or emulator). Deferred;
  the provider interface exists so it can be added without touching anything else.
- ❌ Unbounded native-module mock chasing in snap-web. The mock registry covers a fixed
  short list (reanimated, gesture-handler, safe-area-context, svg, expo-image). Any screen
  that still crashes on mount ⇒ diagnostic + param-card fallback, pipeline continues.
  Never block a release rescuing individual screens.
- ❌ Runtime instrumentation / devtools hooks. wirenav is pure static analysis + optional
  headless mounting.
- ❌ 100% coverage of dynamic JSX registration. Best-effort + diagnostics is the contract.
- ❌ JS-only (non-TypeScript) project support. TS-only is an accepted 2026 trade-off; it
  buys us ParamList type extraction via the type checker.

## Tech stack

- TypeScript strict mode everywhere; ESM only.
- `ts-morph` for AST work in extract-react-navigation (drop to the raw compiler API only
  where ts-morph's performance is the bottleneck — measure first).
- `vitest` for tests, `tsup` for builds, `changesets` for versioning/publishing.
- Node ≥ 20. No Bun/Deno-specific APIs.

## Testing convention (fixture + golden file)

Every extractor feature is tested as: **source-only** miniature app in `fixtures/<name>/`
(no install step) → run extractor → compare against committed `fixtures/<name>/expected.nav`
golden file, byte-for-byte. Fixtures are organized by version profile; a fixture's
package.json declares the router/SDK version so detection is tested too. When behavior
changes intentionally, regenerate goldens with `pnpm goldens:update` and review the diff
in the PR — the diff of golden files IS the review artifact.

The installed apps under `apps/` serve different layers:
- `example-latest`: snap-web integration tests + end-to-end CLI smoke (`wirenav dump/check/render`)
  + demo assets. The only place image-producing tests run.
- `example-legacy`: extraction-only smoke test (dump + check round-trip) proving old-SDK
  support against a real app layout, not just synthetic fixtures.

Unit tests are for the serializer/differ edge cases; extractors are tested almost
exclusively through fixtures.

## CLI surface (v0.1)

```
wirenav dump   [--out wirenav.nav]     # extract → write baseline
wirenav check  [--baseline wirenav.nav] # extract → diff → exit 1 on drift, human-readable report
wirenav render [--out wirenav.html]    # extract → standalone interactive HTML
```

Router auto-detection: presence of `app/` dir + expo-router in package.json ⇒ Expo Router;
else react-navigation deps ⇒ React Navigation extractor; else error with guidance.

## Sequencing

v0.1 = core IR + serializer + differ + Expo Router extractor (latest + one legacy profile)
       + render-html (param cards) + @wirenav/preview convention + snap-web MVP
       + apps/example-latest.
Build order within v0.1 is strict: core → extractor (latest profile first) →
render-html-with-cards → example-latest (init early; it's the dogfood target for
everything after) → preview → snap-web → legacy profile + example-legacy last.
render-html must be fully functional with an EMPTY SnapshotMap before snap-web work
starts — that is the release escape hatch. "Done" has two tiers: with snapshots (full
demo) or cards-only (still shippable; snap-web moves to a patch release). Never let
snap-web polish block the release.
v0.2 = React Navigation extractor (v7 static API profile) + snap-web hardening (custom
       viewports, fonts, dark mode).
v0.3 = React Navigation v6/dynamic JSX heuristics + defineNavEdge() + snap-device provider.
The React Navigation dynamic extractor is an unbounded edge-case grind — never let it
block a release.

## Working conventions for Claude Code

- Read `.claude/skills/wirenav-dev/SKILL.md` before touching extractors, the serializer,
  or the differ.
- Conventional commits (`feat(extract-xr): ...`, `fix(core): ...`).
- Any change that alters `.nav` output requires: schema version decision + golden file
  regeneration + a line in `CHANGELOG` explaining the drift.
- When uncertain whether something belongs in core vs. an extractor: if it mentions files,
  globs, JSX, or router APIs, it does NOT belong in core.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
