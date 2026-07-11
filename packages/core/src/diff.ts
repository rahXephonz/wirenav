/**
 * IR ↔ IR differ. Implements the differ output contract in
 * `.claude/skills/wirenav-dev/references/nav-format.md`.
 *
 * Grouping:
 *  - destinations: added / removed / changed (keyed by destination `id`, the stable
 *    identity — a screen whose routePath changed but whose file is unchanged is
 *    *changed*, not remove + add).
 *  - a changed destination's param deltas surface as "changed params" in the report.
 *  - edges are keyed by (from, to, file); the text format carries no line number, so
 *    there is no "line moved" drift category.
 *  - declared edges: added / removed fail CI.
 *  - inferred edges: all drift is reported in a separate, non-failing section
 *    (fails only under `--strict-inferred`).
 *  - header (router) drift: informational, never fails on its own.
 */
import type { Destination, NavEdge, NavGraphIR, NavigatorNode, Param } from "./ir.js";
import { canonicalizeParamType } from "./serialize.js";

export interface HeaderDrift {
  from: string;
  to: string;
}

export interface ParamChange {
  name: string;
  from: string;
  to: string;
}

/** Param-level deltas for a single destination present in both graphs. */
export interface ParamDrift {
  added: Param[];
  removed: Param[];
  changed: ParamChange[];
}

export interface DestinationChange {
  id: string;
  /** New routePath. */
  routePath: string;
  /** Set only when the routePath changed under a stable id. */
  routePathFrom?: string;
  params: ParamDrift;
  flagsChanged: boolean;
}

export interface EdgeDrift {
  added: NavEdge[];
  removed: NavEdge[];
}

export interface NavDiff {
  /** Router header change, informational. `null` when unchanged. */
  header: HeaderDrift | null;
  destinations: {
    added: Destination[];
    removed: Destination[];
    changed: DestinationChange[];
  };
  declaredEdges: EdgeDrift;
  inferredEdges: EdgeDrift;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function flattenDestinations(ir: NavGraphIR): Map<string, Destination> {
  const map = new Map<string, Destination>();
  const walk = (nav: NavigatorNode): void => {
    for (const dest of nav.destinations) map.set(dest.id, dest);
    for (const child of nav.children) walk(child);
  };
  for (const nav of ir.navigators) walk(nav);
  return map;
}

function paramKey(p: Param): string {
  return p.name;
}

/** A param is "same" iff name, optionality, and canonical type all match. */
function sameParam(a: Param, b: Param): boolean {
  return (
    a.optional === b.optional && canonicalizeParamType(a.type) === canonicalizeParamType(b.type)
  );
}

function diffParams(oldParams: readonly Param[], newParams: readonly Param[]): ParamDrift {
  const oldMap = new Map(oldParams.map((p) => [paramKey(p), p]));
  const newMap = new Map(newParams.map((p) => [paramKey(p), p]));
  const added: Param[] = [];
  const removed: Param[] = [];
  const changed: ParamChange[] = [];

  for (const [key, np] of newMap) {
    const op = oldMap.get(key);
    if (!op) added.push(np);
    else if (!sameParam(op, np)) {
      changed.push({
        name: np.name,
        from: printParamType(op),
        to: printParamType(np),
      });
    }
  }
  for (const [key, op] of oldMap) {
    if (!newMap.has(key)) removed.push(op);
  }

  added.sort((a, b) => cmp(a.name, b.name));
  removed.sort((a, b) => cmp(a.name, b.name));
  changed.sort((a, b) => cmp(a.name, b.name));
  return { added, removed, changed };
}

function printParamType(p: Param): string {
  return `${p.optional ? "?" : ""}${canonicalizeParamType(p.type)}`;
}

function flagsEqual(a: Destination, b: Destination): boolean {
  return (
    Boolean(a.flags.conditional) === Boolean(b.flags.conditional) &&
    a.flags.special === b.flags.special
  );
}

function paramDriftEmpty(d: ParamDrift): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

function edgeKey(e: { from: string; to: string; source: { file: string } }): string {
  return `${e.from} -> ${e.to} ${e.source.file}`;
}

/**
 * Diff edges of one kind, keyed by (from, to, file). Note: two edges sharing the same
 * endpoints AND file (e.g. two `navigate()` calls to the same screen in one file)
 * collapse to one key; this is acceptable for v1 (endpoints, not call sites, are the
 * drift unit). Line numbers are not part of identity, so a line shift is never drift.
 */
function diffEdges(oldEdges: readonly NavEdge[], newEdges: readonly NavEdge[]): EdgeDrift {
  const oldMap = new Map(oldEdges.map((e) => [edgeKey(e), e]));
  const newMap = new Map(newEdges.map((e) => [edgeKey(e), e]));
  const added: NavEdge[] = [];
  const removed: NavEdge[] = [];

  for (const [key, ne] of newMap) {
    if (!oldMap.has(key)) added.push(ne);
  }
  for (const [key, oe] of oldMap) {
    if (!newMap.has(key)) removed.push(oe);
  }

  const byEndpoints = (a: NavEdge, b: NavEdge): number =>
    cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.source.file, b.source.file);
  added.sort(byEndpoints);
  removed.sort(byEndpoints);
  return { added, removed };
}

/** Compute the drift of `next` relative to `baseline`. */
export function diff(baseline: NavGraphIR, next: NavGraphIR): NavDiff {
  const oldDests = flattenDestinations(baseline);
  const newDests = flattenDestinations(next);

  const added: Destination[] = [];
  const removed: Destination[] = [];
  const changed: DestinationChange[] = [];

  for (const [id, nd] of newDests) {
    const od = oldDests.get(id);
    if (!od) {
      added.push(nd);
      continue;
    }
    const params = diffParams(od.params, nd.params);
    const routeChanged = od.routePath !== nd.routePath;
    const flagsChanged = !flagsEqual(od, nd);
    if (!paramDriftEmpty(params) || routeChanged || flagsChanged) {
      changed.push({
        id,
        routePath: nd.routePath,
        routePathFrom: routeChanged ? od.routePath : undefined,
        params,
        flagsChanged,
      });
    }
  }
  for (const [id, od] of oldDests) {
    if (!newDests.has(id)) removed.push(od);
  }

  added.sort((a, b) => cmp(a.routePath, b.routePath) || cmp(a.id, b.id));
  removed.sort((a, b) => cmp(a.routePath, b.routePath) || cmp(a.id, b.id));
  changed.sort((a, b) => cmp(a.routePath, b.routePath) || cmp(a.id, b.id));

  const oldRouter = `${baseline.router.name}@${baseline.router.major}`;
  const newRouter = `${next.router.name}@${next.router.major}`;
  const header: HeaderDrift | null =
    oldRouter === newRouter ? null : { from: oldRouter, to: newRouter };

  return {
    header,
    destinations: { added, removed, changed },
    declaredEdges: diffEdges(
      baseline.edges.filter((e) => e.kind === "declared"),
      next.edges.filter((e) => e.kind === "declared"),
    ),
    inferredEdges: diffEdges(
      baseline.edges.filter((e) => e.kind === "inferred"),
      next.edges.filter((e) => e.kind === "inferred"),
    ),
  };
}

export interface DriftOptions {
  /** Treat inferred-edge drift as failing (raises exit code to 1). */
  strictInferred?: boolean;
}

export interface DriftVerdict {
  /** Any drift at all (including informational)? */
  hasDrift: boolean;
  /** Structural drift the differ fails CI on. */
  hasFailingDrift: boolean;
  /** Inferred-edge drift (non-failing unless `strictInferred`). */
  hasInferredDrift: boolean;
  /** Router header change (always informational). */
  hasInformationalDrift: boolean;
  /** Process exit code: 1 on failing drift, else 0. */
  exitCode: 0 | 1;
}

function edgeDriftEmpty(d: EdgeDrift): boolean {
  return d.added.length === 0 && d.removed.length === 0;
}

/** Classify a diff into failing/warning/clean and the CLI exit code. */
export function classifyDrift(d: NavDiff, options: DriftOptions = {}): DriftVerdict {
  const dest = d.destinations;
  const declaredStructural =
    dest.added.length > 0 ||
    dest.removed.length > 0 ||
    dest.changed.length > 0 ||
    d.declaredEdges.added.length > 0 ||
    d.declaredEdges.removed.length > 0;

  const hasInferredDrift = !edgeDriftEmpty(d.inferredEdges);
  const hasInformationalDrift = d.header !== null;

  const hasFailingDrift =
    declaredStructural || (Boolean(options.strictInferred) && hasInferredDrift);
  const hasDrift = declaredStructural || hasInferredDrift || hasInformationalDrift;

  return {
    hasDrift,
    hasFailingDrift,
    hasInferredDrift,
    hasInformationalDrift,
    exitCode: hasFailingDrift ? 1 : 0,
  };
}

/** True when there is no drift of any kind. */
export function isClean(d: NavDiff): boolean {
  return !classifyDrift(d).hasDrift;
}

// ---------------------------------------------------------------------------
// Human-readable report
// ---------------------------------------------------------------------------

function paramLabel(p: Param): string {
  return `param ${p.name}: ${printParamType(p).replace(/^\?/, "")}${p.optional ? " (optional)" : ""}`;
}

/**
 * Format a diff as the grouped, human-readable report `wirenav check` prints.
 * Returns a "clean" line when there is no drift. Sections appear only when non-empty.
 */
export function formatDiff(d: NavDiff, options: DriftOptions & { baseline?: string } = {}): string {
  const verdict = classifyDrift(d, options);
  if (!verdict.hasDrift) return "✓ no navigation drift\n";

  const lines: string[] = [];
  const baselineNote = options.baseline ? ` (baseline: ${options.baseline})` : "";
  const marker = verdict.hasFailingDrift ? "✖" : "⚠";
  lines.push(`${marker} navigation drift detected${baselineNote}`, "");

  const dest = d.destinations;
  if (dest.added.length > 0) {
    lines.push(`  added destinations (${dest.added.length})`);
    for (const s of dest.added) lines.push(`    + ${s.routePath}    ${s.id}`);
  }
  if (dest.removed.length > 0) {
    lines.push(`  removed destinations (${dest.removed.length})`);
    for (const s of dest.removed) lines.push(`    - ${s.routePath}    ${s.id}`);
  }

  // Param-level changes, drawn from changed destinations.
  const paramChanges = dest.changed.filter((c) => !paramDriftEmpty(c.params));
  if (paramChanges.length > 0) {
    const count = paramChanges.reduce(
      (n, c) => n + c.params.added.length + c.params.removed.length + c.params.changed.length,
      0,
    );
    lines.push(`  changed params (${count})`);
    for (const c of paramChanges) {
      for (const ch of c.params.changed) {
        lines.push(`    ~ ${c.routePath}  param ${ch.name}: ${ch.from}  →  ${ch.to}`);
      }
      for (const p of c.params.added) lines.push(`    + ${c.routePath}  ${paramLabel(p)}`);
      for (const p of c.params.removed) lines.push(`    - ${c.routePath}  ${paramLabel(p)}`);
    }
  }

  // Route/flag changes under a stable id (not param-only).
  const otherChanges = dest.changed.filter((c) => c.routePathFrom !== undefined || c.flagsChanged);
  if (otherChanges.length > 0) {
    lines.push(`  changed destinations (${otherChanges.length})`);
    for (const c of otherChanges) {
      if (c.routePathFrom !== undefined) {
        lines.push(`    ~ ${c.id}  route ${c.routePathFrom}  →  ${c.routePath}`);
      }
      if (c.flagsChanged) lines.push(`    ~ ${c.routePath}  flags changed`);
    }
  }

  if (d.declaredEdges.added.length > 0) {
    lines.push(`  added declared edges (${d.declaredEdges.added.length})`);
    for (const e of d.declaredEdges.added) lines.push(`    + ${e.from} -> ${e.to}`);
  }
  if (d.declaredEdges.removed.length > 0) {
    lines.push(`  removed declared edges (${d.declaredEdges.removed.length})`);
    for (const e of d.declaredEdges.removed) lines.push(`    - ${e.from} -> ${e.to}`);
  }

  const inf = d.inferredEdges;
  if (!edgeDriftEmpty(inf)) {
    const count = inf.added.length + inf.removed.length;
    lines.push(`  inferred-edge drift (${count}, non-failing by default)`);
    for (const e of inf.added) lines.push(`    + ${e.from} -> ${e.to}`);
    for (const e of inf.removed) lines.push(`    - ${e.from} -> ${e.to}`);
  }

  // Informational: header drift.
  if (d.header) {
    lines.push("  router changed (informational)");
    lines.push(`    ~ ${d.header.from}  →  ${d.header.to}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * The `--json` shape: the structured diff plus the verdict. Stable, machine-readable
 * mirror of the human report.
 */
export function diffToJson(
  d: NavDiff,
  options: DriftOptions = {},
): {
  verdict: DriftVerdict;
  diff: NavDiff;
} {
  return { verdict: classifyDrift(d, options), diff: d };
}
