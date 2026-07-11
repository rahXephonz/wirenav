# Expo Router extraction

The filesystem IS the graph. Destinations come from walking `app/`; navigator structure
comes from `_layout` files; edges come from path literals in `<Link href>` and
`router.push/replace/navigate/dismissTo` calls. This document reflects what the code in
`@wirenav/extract-expo-router` (latest profile) actually does — keep it in sync.

## File → route conventions the extractor must handle

| Pattern              | Meaning                                        | IR handling                                  |
|----------------------|------------------------------------------------|----------------------------------------------|
| `index.tsx`          | route of the containing segment                | routePath = parent path                      |
| `[param].tsx`        | dynamic segment                                | param `param: string`, required              |
| `[...rest].tsx`      | catch-all                                      | param `rest: string[]`, required             |
| `(group)/`           | group — in file tree, NOT in URL               | stripped from routePath; navigator only if it has `_layout` |
| `_layout.tsx`        | navigator for its directory                    | navigator node; detect kind (see below)      |
| `+not-found.tsx`     | 404 route                                      | destination, `flags.special = 'not-found'`   |
| `+html.tsx`, `+native-intent.tsx` | infra files                       | skipped entirely (not destinations/navigators) |
| `file+api.ts`        | API route                                      | **silently skipped** (not a screen) — no diagnostic; an intentional skip is not unresolved coverage |

Critical identity rule: destination `id` = repo-relative file path (unique, stable);
`routePath` = URL form with groups + `index` stripped. Two different `(group)` files can
map to the same routePath — that's an Expo Router misconfiguration. Emit **WN201**
(duplicate route) rather than crashing or dropping one: keep every colliding destination
in the IR and emit **one WN201 per colliding file** (each offender located at its own
`id`), so the diff shows all of them.

Navigator/destination attachment: a destination (and a nested navigator) attaches to the
**nearest ancestor directory that has a `_layout`**. Group directories without a `_layout`
are transparent for attachment — their files bubble up to the enclosing navigator.

## Navigator kind detection from _layout

Parse the default export's JSX for the first (outermost, by source position) element whose
tag name is **exactly** `Stack`, `Tabs`, `Drawer`, or `Slot` — matching the exact tag, not
a property access like `Stack.Screen`, so we pick the container not a child config.
`<Slot>` = passthrough → kind `slot`. Unknown/custom layout component ⇒ kind `unknown` +
diagnostic **WN203** (never guess).

> Not yet implemented (deferred, documented in the package README): attaching
> `<Stack.Screen options={{ title, presentation }}>` metadata to child destinations.

## Edge extraction

**Import verification is mandatory.** `<Link>` and `router`/`useRouter` are treated as the
navigation API only when they are imported from `expo-router` (checked via the file's
import declarations, honoring aliases). A locally-defined `Link` component or a `router`
variable from another module produces NO edge — a wrong edge is worse than a missing one.
`router` objects are the imported `router` binding plus variables assigned from
`useRouter()`; destructured/renamed router forms are a documented limitation.

Sources, in confidence order:

1. `<Link href="/path">` and `<Link href={{ pathname: '/user/[id]', params: {...} }}>` —
   **declared** edges. The object form's `pathname` must be a string literal.
2. `router.push('/path')`, `.replace`, `.navigate`, `.dismissTo` with a string or
   no-substitution-template literal, or an object literal with a literal `pathname` —
   **declared**.
3. Template literals with expressions — **narrow** resolution only: shape
   `` `/static/prefix/${expr}` `` (exactly one trailing interpolation, static prefix
   ending in `/`). If that prefix + one dynamic segment matches **exactly one** known
   route, emit an **inferred** edge; otherwise **WN202**. Anything more complex
   (multiple interpolations, interpolation not at the tail) ⇒ WN202.
4. Anything else dynamic (variable, unresolved object) ⇒ **WN202**, no edge.

`Href`-typed const propagation (single-assignment literal resolution) is **not
implemented** (deferred, in the package README).

Edge target normalization: group segments are stripped from href/pathname literals so a
target like `/(tabs)/feed` aligns with the destination routePath `/feed`.

Edge `from` = the route `routePath` of the file containing the call site. Calls inside
shared components (not under `app/`, so not a destination) are attributed to a synthetic
`@shared/<file>` node and are always flagged **`inferred`** (the origin is not a real
screen).

## Diagnostics: stable messages

Every diagnostic `message` is a STABLE, generic string — no `node.getText()`, no source
snippets — so a diagnostic line in the `.nav` text never churns on unrelated edits.
Offending source text (e.g. the unresolvable expression, the declared version range) goes
in the IR's `Diagnostic.detail`, which is surfaced in `--json` and CLI stderr only, never
in the `.nav` text.

Codes: WN104 (unrecognized version → latest profile), WN201 (duplicate route), WN202
(unresolvable navigation target), WN203 (unrecognized navigator layout).

## Typed routes

If the project has `experiments.typedRoutes` enabled, `.expo/types` contains generated
route types — do NOT depend on them (generated, may be stale). Extract from the
filesystem directly; optionally cross-check in `--verify` mode later.

## Param types

Expo Router params are strings at runtime. Default param type: `string` (or `string[]`
for catch-all). Every param type string is passed through `core.canonicalizeParamType()`
before entering the IR (the `Param` invariant). Validated schema extraction is a v2
concern — do not over-engineer now.

## Fixture checklist for this extractor

Minimum fixtures before calling any feature done: nested groups, group + same-name
collision (WN201), tabs inside stack, dynamic + catch-all params, Link object form,
router.push in shared component (`@shared/`), template-literal href (resolvable inferred +
WN202), `<Slot>` passthrough layout, special files (`+not-found` flag, `+html` /
`+native-intent` / `+api` skips), unknown navigator (WN203), and a local same-named `Link`
component asserting NO edge (import verification). A version-detection fixture (unknown
version ⇒ WN104) exercises detection + extraction together.
