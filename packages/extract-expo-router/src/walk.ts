import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Convert an absolute path to a repo-relative POSIX path (forward slashes). */
export function relPosix(root: string, abs: string): string {
  return relative(root, abs).split(sep).join("/");
}

const SOURCE_EXT = new Set([".ts", ".tsx"]);

function isSource(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && SOURCE_EXT.has(name.slice(dot));
}

/**
 * Recursively list TS/TSX files under `dir`, sorted for determinism. Skips
 * `node_modules` and dotfiles/dirs. Returns absolute paths.
 */
export function walkSources(dir: string): string[] {
  const out: string[] = [];
  const rec = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = join(d, e.name);
      if (e.isDirectory()) rec(abs);
      else if (e.isFile() && isSource(e.name)) out.push(abs);
    }
  };
  rec(dir);
  return out;
}
