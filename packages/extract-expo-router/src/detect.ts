import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Detection {
  /** Detected major version (0 when unparseable). */
  major: number;
  /** Raw version range from package.json, or null when absent. */
  raw: string | null;
}

/**
 * Read the target's package.json and extract the declared `expo-router` version. No
 * install / dependency resolution — declared version strings only (extractors are
 * static analyzers per CLAUDE.md).
 */
export function detectExpoRouter(rootDir: string): Detection {
  let raw: string | null = null;
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    raw = deps["expo-router"] ?? null;
  } catch {
    raw = null;
  }
  const major = parseMajor(raw);
  return { major: major ?? 0, raw };
}

function parseMajor(range: string | null): number | null {
  if (!range) return null;
  const m = /(\d+)/.exec(range.replace(/^[\^~>=<\s]*/, ""));
  return m ? Number(m[1]) : null;
}
