/**
 * @wirenav/extract-expo-router — Expo Router static extractor.
 *
 * Produces Graph IR from an Expo Router app's filesystem + TS AST (ts-morph). Depends
 * only on `@wirenav/core` (types + `canonicalizeParamType`); nothing downstream imports
 * from here (the N + M architecture rule in CLAUDE.md).
 */
export { extract } from "./extract.js";
export { detectExpoRouter, type Detection } from "./detect.js";
export { selectProfile, profiles, latestProfile, type VersionProfile } from "./profiles/index.js";
export { DIAG } from "./diagnostics.js";
