# @wirenav/extract-expo-router

Static extractor for [Expo Router](https://docs.expo.dev/router/introduction/) apps. Walks
the `app/` filesystem and parses TypeScript (via ts-morph) to produce a `@wirenav/core`
Graph IR — no install, no dependency resolution, source + `package.json` only.

```ts
import { extract } from "@wirenav/extract-expo-router";
import { serialize } from "@wirenav/core";

const ir = extract("/path/to/expo-app");
console.log(serialize(ir)); // deterministic .nav text
```

Depends only on `@wirenav/core` (plus ts-morph). Nothing downstream imports from here.

## What it extracts

- Destinations from route files; `routePath` (groups + `index` stripped) and stable `id`
  (repo-relative file path).
- Params from `[param]` (`string`) and `[...rest]` (`string[]`) segments.
- Navigator tree + kind from `_layout` files (`Stack`/`Tabs`/`Drawer`/`Slot`).
- Edges from `<Link href>` and `router.push/replace/navigate/dismissTo`, with import
  verification (only APIs imported from `expo-router` count).
- `+not-found` → `flags.special = 'not-found'`.

See `.claude/skills/wirenav-dev/references/expo-router-extraction.md` for the full contract
and diagnostic codes (WN104/WN201/WN202/WN203).

## Version support

Latest profile only (`expo-router` v3–v5). Detection reads `package.json`; an unrecognized
version falls back to the latest profile with a **WN104** diagnostic. The detected major is
recorded in the `.nav` `router:` header so misdetection is visible in diffs.

## Known limitations (v1)

These patterns are intentionally **not** handled yet; each fails safe (no edge / a
diagnostic), never a wrong edge:

- **Destructured / renamed router calls** — `const { push } = useRouter()` (and other
  renamings that lose the `router` object identifier) are not detected. Only the imported
  `router` binding and `const x = useRouter()` variables are.
- **`Href`-typed const propagation** — a `const path: Href = '/x'` then `router.push(path)`
  is not resolved to an edge.
- **`<Stack.Screen options>` metadata** — `title` / `presentation` etc. on child screens
  are not attached to destinations.

Other deliberate scope choices: TypeScript-only (no JS projects); `+api` routes are
silently skipped; generated `.expo/types` are never trusted.
