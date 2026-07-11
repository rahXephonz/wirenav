/**
 * Graph IR — the neutral intermediate representation every extractor produces and
 * every downstream consumer (serializer, differ, renderer) reads.
 *
 * INVARIANT (CLAUDE.md): this module — and all of `@wirenav/core` — is runtime-free.
 * No React, react-native, Expo, filesystem, glob, JSX, or router-API knowledge lives
 * here. If a type needs to describe files/globs/JSX, it belongs in an extractor, not
 * in the IR.
 *
 * All string paths in the IR are **repo-relative POSIX** (forward slashes, no drive
 * letters, no leading `/`). Normalization happens at the extractor boundary; core
 * assumes inputs already obey this.
 */

/** Current `.nav` schema version, emitted as the `wirenav-format:` header. */
export const NAV_FORMAT_VERSION = 1;

/**
 * The `.nav` schema versions this build can parse. The differ must read the current
 * version and one back (see nav-format.md versioning policy). v1 is the only version
 * that exists today.
 */
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1];

/**
 * Detected router + its major version. Serialized into the `router:` header as
 * `name@major` (e.g. `expo-router@5`). Header drift is reported by the differ as
 * informational, since an SDK bump should be visible but should not, on its own,
 * fail CI.
 */
export interface RouterInfo {
  /** Package-ish identifier, e.g. `expo-router` or `react-navigation`. */
  name: string;
  /** Major version of the resolved profile, e.g. `5`. */
  major: number;
}

/**
 * A source location: repo-relative POSIX file + 1-based line number.
 *
 * `line` is IR/`--json`-only — it is deliberately NOT written to the `.nav` text
 * format, because line numbers churn on unrelated edits and would produce spurious
 * text drift. A location parsed back from a `.nav` file therefore has `line: 0`.
 */
export interface SourceLocation {
  file: string;
  line: number;
}

/**
 * A typed route parameter.
 *
 * `type` is a printed TypeScript type (e.g. `string`, `'likes' | 'posts'`).
 *
 * INVARIANT for extractor authors: every param `type` string MUST be passed through
 * `canonicalizeParamType()` from `@wirenav/core` as the final step before it is placed
 * in the IR — that is the single source of truth for canonical form (top-level union
 * members sorted, string literals single-quoted, `' | '` join). Do not hand-format
 * union types in an extractor and do not rely on the serializer to fix a sloppy string
 * (it re-canonicalizes defensively, but IR consumers other than the serializer — e.g.
 * the differ's param comparison — assume the stored value is already canonical).
 */
export interface Param {
  /** Parameter name (a route/segment identifier, e.g. `userId`). */
  name: string;
  /** Whether the param is optional (`tab?`). Optional params sort after required. */
  optional: boolean;
  /** Canonical printed TypeScript type (see invariant above). */
  type: string;
}

/** Markers on a destination. Absent flags are not serialized. */
export interface DestinationFlags {
  /**
   * Rendered conditionally (behind auth, a feature flag, a runtime branch) rather
   * than unconditionally present in the graph.
   */
  conditional?: boolean;
  /**
   * A router "special" screen, carrying its kind. A string union (not a boolean) so
   * new special kinds can be added without a grammar change — serialized as
   * `[special:<kind>]`. Today the only kind is `not-found` (Expo Router `+not-found`).
   */
  special?: "not-found";
}

/**
 * A navigable screen.
 *
 * `id` is the destination's **stable identity** across extractions — the
 * repo-relative POSIX path of the file that defines it. The differ keys on `id`, so
 * a screen whose `routePath` changes but whose file is unchanged is a *changed*
 * destination, not a remove + add. `routePath` is the URL-shaped path used for
 * display, sorting, and edge endpoints.
 */
export interface Destination {
  /** Repo-relative POSIX file path. Stable identity for diffing. */
  id: string;
  /** URL-shaped route path, e.g. `/` or `/(tabs)/profile` → `/profile`. */
  routePath: string;
  params: Param[];
  /** Deep-link URL patterns that resolve to this destination. */
  deepLinks: string[];
  flags: DestinationFlags;
}

/** Navigator container kind. `unknown` is used when detection is inconclusive. */
export type NavigatorKind = "stack" | "tabs" | "drawer" | "slot" | "unknown";

/**
 * A navigator container. Navigators nest arbitrarily: `children` holds nested
 * navigators, `destinations` holds the screens registered directly on this
 * navigator.
 *
 * `file` (the layout/registration file) is optional: a synthetic root navigator may
 * have none. `name` is a display label (e.g. `app`, `(tabs)`), not an identity — the
 * differ compares the destination tree by destination `id`, not by navigator name.
 */
export interface NavigatorNode {
  kind: NavigatorKind;
  /** Display name, e.g. `app` or `(tabs)`. */
  name: string;
  /** Layout/registration file (repo-relative POSIX), if any. */
  file?: string;
  children: NavigatorNode[];
  destinations: Destination[];
}

/**
 * A navigation edge between two route paths.
 *
 * `kind` provenance is load-bearing (CLAUDE.md invariant 2):
 * - `declared` — from `defineNavEdge()` markers or path literals that resolve 1:1 to
 *   a route. Treated as hard drift by the differ.
 * - `inferred` — from call-site analysis of `navigate/push/replace`. May be wrong;
 *   reported by the differ in a separate, non-failing section.
 *
 * Never upgrade an inferred edge to declared to make output look cleaner.
 */
export interface NavEdge {
  /** Source `routePath`. */
  from: string;
  /** Target `routePath`. */
  to: string;
  kind: "declared" | "inferred";
  source: SourceLocation;
}

/**
 * An honest-coverage record: something the extractor could not statically resolve.
 * Never a substitute for silently dropping or guessing (CLAUDE.md invariant 3).
 */
export interface Diagnostic {
  /** Stable machine code, e.g. `WN101`. */
  code: string;
  /**
   * Human-readable single-line explanation. MUST be STABLE — a generic, byte-stable
   * string with no source snippets or `node.getText()` output, so a diagnostic line in
   * the `.nav` text does not churn when unrelated source moves. Offending source text
   * belongs in {@link detail}.
   */
  message: string;
  /** Repo-relative POSIX file the diagnostic anchors to. */
  file: string;
  /** 1-based line. */
  line: number;
  /**
   * Optional offending source text / extra context (e.g. the unresolvable expression).
   * Surfaced in `--json` and CLI stderr ONLY — never written to the `.nav` text format,
   * because it may contain churny source snippets.
   */
  detail?: string;
}

/**
 * The whole navigation graph for one app.
 *
 * `navigators` is a list of top-level navigators (usually one, but a
 * React Navigation app can mount several). The serializer sorts them deterministically
 * by file, so insertion order here is irrelevant.
 */
export interface NavGraphIR {
  /** Schema version this IR targets. Normally {@link NAV_FORMAT_VERSION}. */
  formatVersion: number;
  router: RouterInfo;
  navigators: NavigatorNode[];
  edges: NavEdge[];
  diagnostics: Diagnostic[];
}
