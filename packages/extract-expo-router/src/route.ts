import { canonicalizeParamType } from "@wirenav/core";
import type { Param } from "@wirenav/core";

/**
 * File → route conventions (Expo Router). All inputs are POSIX segment strings with no
 * file extension; group segments `(x)` are stripped from URLs but retained in the file
 * `id`. See `references/expo-router-extraction.md`.
 */

export function segments(relNoExt: string): string[] {
  return relNoExt.split("/").filter((s) => s.length > 0);
}

export function isGroup(seg: string): boolean {
  return seg.startsWith("(") && seg.endsWith(")");
}
export function isCatchAll(seg: string): boolean {
  return seg.startsWith("[...") && seg.endsWith("]");
}
export function isDynamic(seg: string): boolean {
  return seg.startsWith("[") && seg.endsWith("]");
}

/** URL-shaped route path for a route file (groups + `index` removed). */
export function routePathFor(relNoExt: string): string {
  const url = segments(relNoExt).filter((s) => !isGroup(s) && s !== "index");
  return "/" + url.join("/");
}

/** Params implied by dynamic/catch-all segments. Types run through core canonicalization. */
export function paramsFor(relNoExt: string): Param[] {
  const params: Param[] = [];
  for (const seg of segments(relNoExt)) {
    if (isCatchAll(seg)) {
      params.push({
        name: seg.slice(4, -1),
        optional: false,
        type: canonicalizeParamType("string[]"),
      });
    } else if (isDynamic(seg)) {
      params.push({
        name: seg.slice(1, -1),
        optional: false,
        type: canonicalizeParamType("string"),
      });
    }
  }
  return params;
}

/** Strip group segments from a URL path so hrefs align with destination routePaths. */
export function stripGroups(path: string): string {
  const segs = path.split("/").filter((s) => s.length > 0 && !isGroup(s));
  return "/" + segs.join("/");
}
