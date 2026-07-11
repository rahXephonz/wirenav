/**
 * IR → `.nav` text. Implements the determinism rules in
 * `.claude/skills/wirenav-dev/references/nav-format.md` (v1).
 *
 * Determinism contract (all mandatory):
 *  1. Destinations sorted by routePath (then id) within a navigator; navigators
 *     sorted by file (then name, kind). Never insertion order.
 *  2. Params: required first (alpha), then optional (alpha).
 *  3. Param types canonical: union members sorted, single quotes, `' | '` join.
 *  4. Edges sorted by (from, to, file); declared and inferred in separate sections.
 *     Line numbers are NOT written to the text format (they churn on unrelated
 *     edits); `line` survives in the IR and in `--json` only.
 *  5. Repo-relative POSIX paths only; LF endings; single trailing newline.
 *  6. Anything else nondeterministic is sorted before emission.
 *
 * Layout note: the format spec renders columns space-aligned for readability, but
 * this serializer emits **single-space** separators. Column alignment would repad
 * (and thus dirty) every line whenever one route's width changes — the opposite of
 * the git-diff-friendliness the format exists for. Single-space is still fully
 * deterministic and parses unambiguously.
 */
import type { Destination, Diagnostic, NavEdge, NavGraphIR, NavigatorNode, Param } from "./ir.js";

const INDENT = "  ";

/** Case-sensitive lexicographic compare (stable, locale-independent). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonicalize a printed TypeScript type per determinism rule 3.
 *
 * Scope is deliberately narrow: top-level union member sorting + normalization of
 * double-quoted string literals to single quotes. It does NOT parse nested generics
 * or object types (core is TypeScript-compiler-free); a `|` inside `Record<A, B|C>`
 * would be split naively. That is acceptable for v1 route params, which are
 * primitives and string-literal unions. Extractors that need richer types should
 * hand over an already-canonical string.
 */
export function canonicalizeParamType(type: string): string {
  const members = type
    .split("|")
    .map((m) => normalizeQuotes(m.trim()))
    .filter((m) => m.length > 0);
  const unique = Array.from(new Set(members)).sort(cmp);
  return unique.join(" | ");
}

function normalizeQuotes(member: string): string {
  const doubleQuoted = /^"((?:[^"\\]|\\.)*)"$/.exec(member);
  if (doubleQuoted) return `'${doubleQuoted[1]}'`;
  return member;
}

function sortParams(params: readonly Param[]): Param[] {
  return [...params].sort((a, b) => {
    if (a.optional !== b.optional) return a.optional ? 1 : -1;
    return cmp(a.name, b.name);
  });
}

function sortDestinations(dests: readonly Destination[]): Destination[] {
  return [...dests].sort((a, b) => cmp(a.routePath, b.routePath) || cmp(a.id, b.id));
}

function sortNavigators(navs: readonly NavigatorNode[]): NavigatorNode[] {
  return [...navs].sort(
    (a, b) => cmp(a.file ?? "", b.file ?? "") || cmp(a.name, b.name) || cmp(a.kind, b.kind),
  );
}

function sortEdges(edges: readonly NavEdge[]): NavEdge[] {
  return [...edges].sort(
    (a, b) =>
      cmp(a.from, b.from) ||
      cmp(a.to, b.to) ||
      cmp(a.source.file, b.source.file) ||
      a.source.line - b.source.line,
  );
}

function sortDiagnostics(diags: readonly Diagnostic[]): Diagnostic[] {
  return [...diags].sort(
    (a, b) =>
      cmp(a.code, b.code) || cmp(a.file, b.file) || a.line - b.line || cmp(a.message, b.message),
  );
}

function flagTokens(dest: Destination): string {
  const tokens: string[] = [];
  // Fixed order so output is stable regardless of how flags were set.
  if (dest.flags.conditional) tokens.push("[conditional]");
  if (dest.flags.special) tokens.push(`[special:${dest.flags.special}]`);
  return tokens.length > 0 ? ` ${tokens.join(" ")}` : "";
}

function emitParam(p: Param): string {
  const optional = p.optional ? "?" : "";
  return `param ${p.name}${optional}: ${canonicalizeParamType(p.type)}`;
}

function emitDestination(dest: Destination, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  const childPad = INDENT.repeat(depth + 1);
  out.push(`${pad}destination ${dest.routePath} file=${dest.id}${flagTokens(dest)}`);
  for (const p of sortParams(dest.params)) out.push(`${childPad}${emitParam(p)}`);
  for (const link of [...dest.deepLinks].sort(cmp)) out.push(`${childPad}deeplink ${link}`);
}

function emitNavigator(nav: NavigatorNode, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth);
  const fileAttr = nav.file ? ` file=${nav.file}` : "";
  out.push(`${pad}navigator ${nav.name} [${nav.kind}]${fileAttr}`);
  // Destinations before nested navigators (matches nav-format.md v1 shape).
  for (const dest of sortDestinations(nav.destinations)) emitDestination(dest, depth + 1, out);
  for (const child of sortNavigators(nav.children)) emitNavigator(child, depth + 1, out);
}

function emitEdge(e: NavEdge): string {
  // No line number in text — see determinism rule 4. `line` lives in the IR / --json.
  return `${INDENT}${e.from} -> ${e.to} ${e.source.file}`;
}

function emitDiagnostic(d: Diagnostic): string {
  // No line number in text — consistent with edges; `line` lives in the IR / --json.
  return `${INDENT}${d.code} ${d.message} ${d.file}`;
}

/**
 * Serialize an IR to deterministic `.nav` text. Same logical input ⇒ byte-identical
 * output regardless of array insertion order. Ends with exactly one trailing `\n`.
 */
export function serialize(ir: NavGraphIR): string {
  // Each entry is one section; sections are joined by a single blank line.
  const sections: string[][] = [];

  sections.push([
    `wirenav-format: ${ir.formatVersion}`,
    `router: ${ir.router.name}@${ir.router.major}`,
  ]);

  const navLines: string[] = [];
  for (const nav of sortNavigators(ir.navigators)) emitNavigator(nav, 0, navLines);
  if (navLines.length > 0) sections.push(navLines);

  const declared = sortEdges(ir.edges.filter((e) => e.kind === "declared"));
  if (declared.length > 0) sections.push(["edges declared", ...declared.map(emitEdge)]);

  const inferred = sortEdges(ir.edges.filter((e) => e.kind === "inferred"));
  if (inferred.length > 0) sections.push(["edges inferred", ...inferred.map(emitEdge)]);

  const diags = sortDiagnostics(ir.diagnostics);
  if (diags.length > 0) sections.push(["diagnostics", ...diags.map(emitDiagnostic)]);

  return sections.map((s) => s.join("\n")).join("\n\n") + "\n";
}
