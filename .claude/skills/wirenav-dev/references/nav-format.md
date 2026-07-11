# .nav format — determinism & versioning rules

The `.nav` file is wirenav's public API. It is committed to user repos and diffed in CI,
so it must be: human-readable, git-diff-friendly, and **byte-deterministic** for a given
input tree. This document is the spec that `@wirenav/core` (`serialize.ts`, `parse.ts`,
`diff.ts`) implements — keep it in sync with the code.

## Shape (v1)

```
wirenav-format: 1
router: expo-router@5

navigator app [stack]
  destination / file=app/index.tsx
  destination /login file=app/login.tsx [special]
  navigator (tabs) [tabs] file=app/(tabs)/_layout.tsx
    destination /feed file=app/(tabs)/feed.tsx
    destination /profile file=app/(tabs)/profile.tsx
      param userId: string
      param tab?: 'likes' | 'posts'
      deeplink myapp://u/:userId

edges declared
  /feed -> /profile app/(tabs)/feed.tsx
  /login -> / app/login.tsx

edges inferred
  /profile -> /login app/(tabs)/profile.tsx

diagnostics
  WN101 dynamic route name not statically resolvable src/hooks/useNav.ts
```

Plain indented text, not JSON/YAML — line-oriented so git diffs read as "screen added",
"param type changed", "edge removed". One fact per line.

### Line grammar (single-space separated)

Tokens on a line are separated by a **single space** — the format is NOT column-aligned.
Alignment would repad (and dirty) every line whenever one route's width changed, which is
the opposite of the git-diff-friendliness the format exists for. Indentation is 2 spaces
per nesting level.

- `navigator <name> [<kind>]` optionally ` file=<path>`. `<kind>` ∈
  `stack | tabs | drawer | slot | unknown`. The root navigator may omit `file=`.
- `destination <routePath> file=<id>` optionally followed by flag tokens. `<id>` is the
  repo-relative POSIX file path and is the destination's **stable identity**;
  `<routePath>` is the URL form. Flag tokens, in fixed order: `[conditional]` then
  `[special]` (emitted only when true).
- `param <name>[?]: <type>` — nested under its destination (+2 indent). `?` marks optional.
- `deeplink <url>` — nested under its destination, after its params.
- Edge lines (under `edges declared` / `edges inferred`): `<from> -> <to> <file>`.
- Diagnostic lines (under `diagnostics`): `<code> <message> <file>`.

Route paths and file paths are assumed to contain no spaces (true for URL-shaped routes
and repo-relative POSIX paths). Param and diagnostic messages may contain spaces.

Within a destination, params are listed before deep links. Within a navigator,
destinations are listed before nested navigators.

Empty sections are omitted entirely (no bare `edges declared` header when there are no
declared edges). A header-only graph is just the two `wirenav-format:` / `router:` lines.

### No line numbers in the text format

Source line numbers are intentionally **absent** from `.nav` text. They churn on unrelated
edits and would produce spurious drift in `wirenav check`. The line number survives in the
in-memory IR (`SourceLocation.line`) and in `wirenav check --json`; a location parsed back
from a `.nav` file has `line: 0`. Because edge identity does not include the line, moving a
`navigate()` call to a different line is never reported as drift.

### The `router:` header

Carries the detected version profile as `name@major` (`expo-router@5`). It is diffable
content on purpose — profile misdetection or an SDK upgrade surfaces in `wirenav check` as
header drift, reported as **informational (non-failing)** unless destinations/edges also
drifted.

## Determinism rules (all mandatory)

1. Destinations sorted lexicographically by `routePath` (then `id`) within their navigator;
   navigators sorted by file path (then name, then kind). Never insertion/discovery order.
2. Params sorted: required first (alphabetical), then optional (alphabetical).
3. Param types printed in TypeScript canonical form via
   `core.canonicalizeParamType()` — top-level union members sorted alphabetically, single
   quotes, `' | '` join (`'likes' | 'posts'`, never `"posts"|"likes"`). This function is
   the single source of truth for canonical form and is a **mandatory final pass** for any
   param type string an extractor puts in the IR (see `ir.ts` `Param` invariant). Its scope
   is deliberately narrow (top-level unions + quote normalization), not full type parsing.
4. Edges sorted by (from, to, file); declared and inferred in separate sections. Line
   numbers are not written (see above), so they play no part in ordering or identity.
5. Repo-relative POSIX paths only. No absolute paths, no `\`, no timestamps, no tool
   version numbers in the body. LF endings, single trailing newline.
6. Anything nondeterministic (map iteration, filesystem readdir order) must be sorted
   before serialization — never rely on incidental ordering.
7. Deep links sorted alphabetically within their destination.

## Versioning policy

- `wirenav-format: N` header is the schema version, independent of package versions.
- **Bump N** when a change breaks the differ's ability to compare old files: renamed
  sections, changed line grammar, changed sort order.
- **No bump** for purely additive lines (new optional attribute at end of line, new
  section the differ ignores when absent) — but goldens still regenerate.
- The parser rejects an unsupported version with a clear "run `wirenav dump` to migrate
  your baseline" error. `SUPPORTED_FORMAT_VERSIONS` in `core` lists what it can read.

## Differ output contract

Drift is grouped, keyed by stable identity:

- **destinations** — added / removed / changed, keyed by destination `id` (the file path).
  A screen whose `routePath` changes but whose file is unchanged is a *changed*
  destination, not remove + add. A changed destination's param deltas surface as
  "changed params".
- **declared edges** — added / removed, keyed by (from, to, file). Both fail CI.
- **inferred edges** — added / removed, keyed by (from, to, file). Reported in a separate
  section; **non-failing by default** (fails only under `--strict-inferred`).
- **header (router)** — informational; never fails on its own.

There is no "line moved" category — line numbers are not part of edge identity.

`wirenav check` failures print a human-readable, grouped report:

```
✖ navigation drift detected (baseline: wirenav.nav)

  added destinations (1)
    + /settings    app/settings.tsx
  changed params (1)
    ~ /profile  param tab: 'posts' | 'likes'  →  'posts' | 'likes' | 'media'
  removed declared edges (1)
    - /feed -> /profile
  inferred-edge drift (1, non-failing by default)
    + /profile -> /login
```

Exit codes: 0 clean; 1 on failing drift (added/removed/changed destinations, added/removed
declared edges); 0 with a warning for inferred-only or header-only drift unless
`--strict-inferred`. Machine-readable `--json` mirrors the same structure and additionally
carries the `line` for each edge/diagnostic.
