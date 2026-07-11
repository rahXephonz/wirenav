/**
 * Diagnostic codes emitted by the Expo Router extractor. Each is honest-coverage:
 * something detected but not fully resolvable, surfaced rather than dropped/guessed.
 *
 * - WN104: unrecognized router version — fell back to the latest profile (best-effort).
 * - WN201: two files resolve to the same routePath (Expo Router misconfiguration).
 * - WN202: a navigation target (href / router.* argument) is not statically resolvable.
 * - WN203: a `_layout` default export's navigator component is unrecognized (kind=unknown).
 */
export const DIAG = {
  WN104: "WN104",
  WN201: "WN201",
  WN202: "WN202",
  WN203: "WN203",
} as const;
