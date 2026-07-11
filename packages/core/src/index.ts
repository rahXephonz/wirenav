/**
 * @wirenav/core — IR types, `.nav` serializer/parser, and differ.
 *
 * This package is runtime-free (no React/react-native/Expo/filesystem). It is the
 * only package extractors, renderers, differs, and the CLI may depend on.
 */
export * from "./ir.js";
export { serialize, canonicalizeParamType } from "./serialize.js";
export { parse, NavParseError } from "./parse.js";
export {
  diff,
  classifyDrift,
  isClean,
  formatDiff,
  diffToJson,
  type NavDiff,
  type HeaderDrift,
  type ParamChange,
  type ParamDrift,
  type DestinationChange,
  type EdgeDrift,
  type DriftOptions,
  type DriftVerdict,
} from "./diff.js";
