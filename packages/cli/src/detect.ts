/**
 * Router auto-detection for the CLI (CLAUDE.md "Router auto-detection"):
 *   app/ dir + expo-router dep        → expo-router extractor
 *   react-navigation deps present     → react-navigation (NOT yet supported; v0.2)
 *   neither                           → guidance error
 *
 * This is CLI-level orchestration, not extraction: it only reads package.json dep names
 * and checks for an `app/` directory. The expo-router extractor does its own, finer
 * version detection from package.json once selected.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type RouterChoice =
  | { router: "expo-router" }
  | { router: "react-navigation"; packages: string[] }
  | { router: "none"; hasAppDir: boolean; hasExpoRouterDep: boolean };

const RN_PACKAGES = [
  "@react-navigation/native",
  "@react-navigation/native-stack",
  "@react-navigation/stack",
  "@react-navigation/bottom-tabs",
  "@react-navigation/drawer",
  "react-navigation",
];

function readDeps(rootDir: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

function hasDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Decide which extractor (if any) applies to the project rooted at `rootDir`. */
export function detectRouter(rootDir: string): RouterChoice {
  const deps = readDeps(rootDir);
  const hasAppDir = hasDir(join(rootDir, "app"));
  const hasExpoRouterDep = "expo-router" in deps;

  if (hasAppDir && hasExpoRouterDep) return { router: "expo-router" };

  const rnPackages = RN_PACKAGES.filter((p) => p in deps);
  if (rnPackages.length > 0) return { router: "react-navigation", packages: rnPackages };

  return { router: "none", hasAppDir, hasExpoRouterDep };
}
