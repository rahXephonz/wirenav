---
name: wirenav-dev
description: Development workflows and invariants for the wirenav codebase — extracting React Native navigation graphs via static analysis. Use this skill whenever working on ANY of - the Graph IR types, the .nav serializer or differ in @wirenav/core, the Expo Router extractor, the React Navigation extractor, edge inference, ParamList type extraction, screen previews (definePreview, snap-web, SnapshotMap, mock registry), fixture/golden-file tests, or the CLI. Also trigger when the user mentions "extractor", ".nav file", "navCheck", "IR", "golden files", "preview", "snapshot", or asks to add support for a new router, navigation pattern, or native-module mock.
---

# wirenav development

wirenav statically extracts RN navigation graphs into an IR, serializes them
deterministically, and diffs them in CI. Read `CLAUDE.md` at the repo root for
architecture context first. This skill covers the *how* of day-to-day work.

## Before writing any code, classify the task

| Task touches...                                | Read first                                   |
|------------------------------------------------|----------------------------------------------|
| `.nav` format, serializer, differ, IR types     | `references/nav-format.md`                   |
| Expo Router extraction (files, Link, router.*)  | `references/expo-router-extraction.md`       |
| React Navigation extraction (AST, ParamList)    | `references/react-navigation-extraction.md`  |
| previews, definePreview, snap-web, SnapshotMap  | `references/preview-rendering.md`            |
| HTML renderer                                   | IR types in `packages/core/src/ir.ts` + SnapshotMap interface |

## The dependency rule (check on every import you add)

`@wirenav/core` imports nothing from extractors. Renderers/differs/CLI import only
`@wirenav/core` (plus their own deps). If a change requires core to know about files,
globs, JSX, or a router API, the design is wrong — move that knowledge into the
extractor and extend the IR instead.

## Fixtures vs apps — never confuse the two layers

- `fixtures/*` — **source-only**, organized by version profile, never installed, never
  have node_modules. Extractors must work from source + package.json alone; if a fixture
  test "needs an install", the extractor has a hidden runtime dependency — that's the bug.
- `apps/example-latest` — real installed Expo app (latest SDK): snap-web tests, CLI
  end-to-end smoke, demo assets.
- `apps/example-legacy` — real installed app on an older supported SDK: extraction smoke
  only. Never add it to snap-web CI, never add more installed apps to cover extractor
  version differences — add source-only fixtures instead.

## Workflow: supporting a router/SDK version difference

1. Identify the convention delta (new special file, renamed API, changed nesting rule).
2. Encode it as data in a version profile under `src/profiles/` — NOT as `if (version)`
   branches inside extraction logic. Profile selection reads the target's package.json.
3. Add a source-only fixture under the matching version directory whose package.json
   declares that version — this tests detection and extraction together.
4. Hand-write the golden. Verify the `.nav` header records the right profile
   (`router: expo-router@5`).
5. Unknown/future versions must fall back to the latest profile + WN104 diagnostic —
   write the fixture for that too when touching detection logic.

## Workflow: initializing the example apps (expo init)

Timing: do NOT scaffold `apps/example-latest` until core + extractor + render-html pass
their fixture tests — the entire static layer needs zero installed apps by design. Init
it when preview/snap-web work begins (per the build order in CLAUDE.md).

1. `pnpm create expo-app apps/example-latest` with the TypeScript template. Let
   create-expo-app pick the actual latest SDK — never hardcode an SDK version from
   memory or docs; the version lives in the generated package.json.
2. **pnpm linker check**: RN/Metro has historically broken under pnpm's isolated
   node_modules. Verify Metro bundles with the default linker FIRST; only add
   `node-linker=hoisted` to the root `.npmrc` if it actually fails — it's a repo-wide
   setting, don't cargo-cult it preemptively.
3. **Metro monorepo config**: the app must resolve workspace packages
   (`@wirenav/preview`). Set `watchFolders` to the repo root and add root + app
   `node_modules` to `resolver.nodeModulesPaths` in metro.config.js at init time — not
   later when snap-web is half-built.
4. Give the app a small but representative nav surface (~8 screens: nested group, tabs
   in stack, dynamic param, a screen with `.preview.tsx`, a screen using a mocked native
   lib). It doubles as the demo-GIF source, so make it visually non-trivial.
5. `apps/example-legacy`: same steps pinned to the oldest supported SDK; extraction
   smoke only. If its install becomes flaky in CI, demote it to a source-only fixture
   rather than fighting old-SDK installs — version coverage is already carried by
   profile fixtures.

## Workflow: adding or changing extractor behavior

1. **Write the fixture first.** Create/extend a miniature app under `fixtures/<name>/`
   that exhibits the pattern (e.g. a `(group)` route, a `.map()` over screens, a wrapper
   navigation hook). Fixtures are the spec.
2. **Write the expected `.nav` golden** by hand for new fixtures — hand-writing it forces
   you to decide what correct output *is* before implementing.
3. Implement. Run `pnpm test` — fixture tests compare byte-for-byte against goldens.
4. If the pattern is **unresolvable statically** (dynamic route names, computed configs):
   do NOT guess and do NOT silently skip. Emit a `Diagnostic { code, message, file, line }`
   and add a fixture asserting the diagnostic is produced. Honest coverage is a feature.
5. Any intentional `.nav` output change: regenerate goldens (`pnpm goldens:update`),
   review the golden diff yourself before presenting it, decide whether the format
   version must bump (see nav-format.md), note it in CHANGELOG.

## Workflow: touching the serializer or differ

Determinism is the product. After any serializer change, run the double-serialize check:
extract the same fixture twice into different temp dirs and `diff` the outputs — they must
be byte-identical. Ordering rules, canonical forms, and versioning policy live in
`references/nav-format.md`; do not improvise new ordering.

## Edge provenance discipline

Every `NavEdge` has `kind: 'declared' | 'inferred'` and a `source: { file, line }`.

- `declared` — from `defineNavEdge()` markers or Expo Router path literals that resolve
  1:1 to a route file. Trustworthy; differ treats changes as hard drift.
- `inferred` — from call-site analysis of `navigate/push/replace`. May be wrong; the
  renderer draws these dashed, and `navCheck` reports their drift separately so teams
  can opt out of failing CI on inferred-edge changes.

Never upgrade an inferred edge to declared to make output look cleaner.

## Testing quick reference

```bash
pnpm test                        # all fixture + unit tests
pnpm test --filter extract-xr    # one package
pnpm goldens:update              # regenerate expected.nav files (review the diff!)
```

A PR that changes extractor logic with no fixture change is suspicious — either the
change is untested or it's dead code. Flag it.

## Common traps

- **ts-morph project loading is slow on big fixtures.** Reuse one `Project` per test file;
  never create one per test case.
- **Path handling:** all paths in IR/diagnostics are repo-relative POSIX (`/` separators),
  even on Windows. Normalize at the extractor boundary, nowhere else.
- **Expo Router groups `(name)` do not appear in the URL** but DO appear in the file tree —
  the IR destination `id` uses the file path, the `routePath` uses the URL form. Confusing
  these breaks edge resolution. Details in expo-router-extraction.md.
- **`navigation.navigate` string matching across navigators:** the same screen name can
  exist in two navigators. Resolution is scoped to the nearest enclosing navigator first,
  then bubbles up — mirror React Navigation's own resolution order, don't invent one.
