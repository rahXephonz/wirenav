# wirenav

**Static analysis toolkit that extracts, visualizes, and diff-checks React Native
navigation graphs** — Expo Router & React Navigation. Recover your app's navigation
structure _without running the app_, commit it to your repo as a deterministic text
file, and fail CI when the navigation surface drifts.

Inspired by [skydoves/compose-nav-graph](https://github.com/skydoves/compose-navigation-graph),
rebuilt around the constraints of the RN ecosystem (no KSP, no headless renderer).

## Why

The navigation structure of an RN app is recoverable **statically** — from the
filesystem (Expo Router) or the TypeScript AST (React Navigation) — without ever
running the app. wirenav extracts that structure into a neutral IR, serializes it to a
deterministic `.nav` file that lives in your repo, and diffs it in CI. The `.nav` file
is a readable, line-oriented contract: a git diff reads as _"screen added"_, _"param
type changed"_, _"edge removed"_.

## The `.nav` file

```
wirenav-format: 1
router: expo-router@5

navigator app [stack] file=app/_layout.tsx
  destination / file=app/index.tsx
  navigator (tabs) [tabs] file=app/(tabs)/_layout.tsx
    destination /feed file=app/(tabs)/feed.tsx
    destination /profile file=app/(tabs)/profile.tsx
      param userId: string
      param tab?: 'likes' | 'posts'

edges declared
  /feed -> /profile app/(tabs)/feed.tsx
```

**Deterministic by contract:** same input tree ⇒ byte-identical file. Sorted
destinations, canonical param types, no timestamps, no absolute paths, no line numbers,
LF endings. The format is versioned (`wirenav-format:`); the full spec lives in
[`references/nav-format.md`](.claude/skills/wirenav-dev/references/nav-format.md).

Every edge carries provenance — `declared` (trustworthy) vs `inferred` (best-effort,
may be wrong) — and the differ reports inferred-edge drift separately so teams can opt
out of failing CI on it. When an extractor can't resolve something statically, it emits
a diagnostic with a file location instead of silently guessing.

## Architecture: IR-first

```
Expo Router files ──┐
                    ├──► Graph IR ──► .nav serializer ──► navCheck differ
React Navigation ───┘        │
     TS AST                  └──► HTML canvas export ──► (future: VS Code webview)
```

Extractors produce IR. Renderers and differs consume IR. Nothing downstream imports
from an extractor — N extractors × M outputs stays N + M. `@wirenav/core` is
runtime-free (no React / react-native / Expo / filesystem), so it runs in any Node ≥ 20
environment including CI.

## Intended CLI surface

Not yet shipped — this is the target for v0.1:

```
wirenav dump   [--out wirenav.nav]      # extract → write baseline
wirenav check  [--baseline wirenav.nav] # extract → diff → exit 1 on drift
wirenav render [--out wirenav.html]     # extract → standalone interactive HTML
```

## Version support (target)

- **Expo Router**: v3+ (SDK 50+). Older ⇒ error with guidance, not silent wrong output.
- **React Navigation**: v6 (dynamic JSX) and v7+ (static API + dynamic).
- **TypeScript only.** TS-only is an accepted trade-off — it buys ParamList type
  extraction via the type checker.

## Development

Requires Node ≥ 20 and pnpm.

```bash
pnpm install
pnpm test              # all fixture + unit tests (vitest)
pnpm typecheck         # tsc --noEmit across packages
pnpm build             # tsup builds
pnpm goldens:update    # regenerate extractor golden files (review the diff!)
```

Extractors are tested almost entirely through **source-only fixtures + golden files**:
a miniature app under `fixtures/` is run through the extractor and its `.nav` output is
compared byte-for-byte against a committed `expected.nav`. Fixtures are never
installed — extractors are static analyzers and must work from source + `package.json`
alone. The diff of golden files _is_ the review artifact.

Contributor guide and invariants: [`CLAUDE.md`](CLAUDE.md) and the
[`wirenav-dev` skill](.claude/skills/wirenav-dev).

## Roadmap

- **v0.1** — core IR + serializer + differ, Expo Router extractor, HTML renderer (param
  cards), preview convention + snap-web MVP.
- **v0.2** — React Navigation extractor (v7 static API), snap-web hardening.
- **v0.3** — React Navigation v6/dynamic JSX heuristics, `defineNavEdge()`, on-device
  preview provider.

## License

GNU General Public License (GPL)
