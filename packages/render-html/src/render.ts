/**
 * IR (+ optional SnapshotMap) → a single, standalone, interactive HTML document.
 *
 * Contract (CLAUDE.md "Previews" + preview-rendering.md):
 *  - Consumes `@wirenav/core` types ONLY. Never imports an extractor or a snapshot
 *    provider (the N + M architecture rule; providers depend on us, not the reverse).
 *  - The output makes ZERO network/filesystem requests: all CSS/JS is inline and any
 *    snapshot image is an inlined `data:` URI. It opens correctly from `file://`.
 *  - Vanilla JS only — no React, no bundled framework.
 *  - Fully release-quality with an EMPTY SnapshotMap: every destination falls back to a
 *    param card (the cards-only shippable tier). Snapshots are presentation, never part
 *    of the `.nav` contract, so layout is NOT required to be deterministic. We still emit
 *    cards in the serializer's canonical order so output is stable input-to-input.
 *
 * Layout is hand-rolled (no dagre): destinations are placed in left-to-right columns by
 * navigator nesting depth; the client script overlays edges as SVG curves measured from
 * the rendered card rectangles. See render-html README notes for the trade-off.
 */
import type {
  Destination,
  NavEdge,
  NavGraphIR,
  NavigatorKind,
  NavigatorNode,
  Param,
} from "@wirenav/core";
import { canonicalizeParamType } from "@wirenav/core";
import { escapeHtml, escapeJsonForScript } from "./escape.js";
import type { RenderOptions, SnapshotMap } from "./types.js";
import { CLIENT_JS } from "./client.js";
import { STYLES } from "./styles.js";

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Canonical ordering (mirrors core/serialize.ts so cards are stable) --------------

function sortDestinations(dests: readonly Destination[]): Destination[] {
  return [...dests].sort((a, b) => cmp(a.routePath, b.routePath) || cmp(a.id, b.id));
}

function sortNavigators(navs: readonly NavigatorNode[]): NavigatorNode[] {
  return [...navs].sort(
    (a, b) => cmp(a.file ?? "", b.file ?? "") || cmp(a.name, b.name) || cmp(a.kind, b.kind),
  );
}

function sortParams(params: readonly Param[]): Param[] {
  return [...params].sort((a, b) => {
    if (a.optional !== b.optional) return a.optional ? 1 : -1;
    return cmp(a.name, b.name);
  });
}

// --- Card / column model -------------------------------------------------------------

/** One placed destination: which column (depth) and which navigator owns it. */
interface PlacedCard {
  dest: Destination;
  depth: number;
  navKind: NavigatorKind;
  navName: string;
}

/** Walk the navigator tree, emitting cards grouped by (column, navigator). */
function place(navigators: readonly NavigatorNode[]): {
  columns: PlacedCard[][];
  maxDepth: number;
} {
  const columns: PlacedCard[][] = [];
  let maxDepth = 0;

  const walk = (nav: NavigatorNode, depth: number): void => {
    maxDepth = Math.max(maxDepth, depth);
    if (!columns[depth]) columns[depth] = [];
    for (const dest of sortDestinations(nav.destinations)) {
      columns[depth].push({ dest, depth, navKind: nav.kind, navName: nav.name });
    }
    for (const child of sortNavigators(nav.children)) walk(child, depth + 1);
  };
  for (const nav of sortNavigators(navigators)) walk(nav, 0);

  return { columns, maxDepth };
}

// --- HTML fragments ------------------------------------------------------------------

function paramLine(p: Param): string {
  const opt = p.optional ? '<span class="opt">?</span>' : "";
  return `<li class="param"><span class="pname">${escapeHtml(p.name)}${opt}</span><span class="ptype">${escapeHtml(
    canonicalizeParamType(p.type),
  )}</span></li>`;
}

function badges(dest: Destination): string {
  const out: string[] = [];
  if (dest.flags.conditional) out.push('<span class="badge badge-cond">conditional</span>');
  if (dest.flags.special)
    out.push(`<span class="badge badge-special">special: ${escapeHtml(dest.flags.special)}</span>`);
  return out.length ? `<div class="badges">${out.join("")}</div>` : "";
}

function cardHtml(card: PlacedCard, snapshots: SnapshotMap): string {
  const { dest } = card;
  const snap = snapshots[dest.id];
  const params = sortParams(dest.params);

  let media = "";
  if (snap && snap.status === "ok" && snap.dataUri) {
    const dims = snap.width && snap.height ? ` width="${snap.width}" height="${snap.height}"` : "";
    media = `<div class="snap"><img src="${escapeHtml(snap.dataUri)}"${dims} alt="${escapeHtml(
      dest.routePath,
    )} preview" loading="lazy" /></div>`;
  } else if (snap) {
    // Any present-but-unusable entry — a non-ok status, OR an "ok" entry with no dataUri
    // (a broken provider). Never silently render a media-less card (honest coverage).
    const why = snap.diagnostic
      ? `: ${escapeHtml(snap.diagnostic)}`
      : snap.status === "ok"
        ? ": missing image data"
        : "";
    media = `<div class="snap-fallback">preview ${escapeHtml(snap.status)}${why}</div>`;
  }

  const paramsBlock = params.length
    ? `<ul class="params">${params.map(paramLine).join("")}</ul>`
    : '<div class="no-params">no params</div>';

  const links = [...dest.deepLinks].sort(cmp);
  const linksBlock = links.length
    ? `<ul class="deeplinks">${links
        .map((l) => `<li class="deeplink">${escapeHtml(l)}</li>`)
        .join("")}</ul>`
    : "";

  return `<article class="card" data-route="${escapeHtml(dest.routePath)}" data-id="${escapeHtml(
    dest.id,
  )}">
  <header class="card-head">
    <span class="route">${escapeHtml(dest.routePath)}</span>
    ${badges(dest)}
  </header>
  ${media}
  <div class="card-body">
    ${paramsBlock}
    ${linksBlock}
    <div class="file">${escapeHtml(dest.id)}</div>
  </div>
</article>`;
}

function navGroupsForColumn(cards: PlacedCard[], snapshots: SnapshotMap): string {
  // Consecutive cards sharing a navigator (they already do, per the placement walk) are
  // wrapped in a labelled group box so containers read as visually grouped.
  const groups: { navName: string; navKind: NavigatorKind; cards: PlacedCard[] }[] = [];
  for (const card of cards) {
    const last = groups[groups.length - 1];
    if (last && last.navName === card.navName && last.navKind === card.navKind) {
      last.cards.push(card);
    } else {
      groups.push({ navName: card.navName, navKind: card.navKind, cards: [card] });
    }
  }
  return groups
    .map(
      (g) => `<section class="nav-group" data-kind="${escapeHtml(g.navKind)}">
  <div class="nav-label"><span class="nav-name">${escapeHtml(
    g.navName,
  )}</span><span class="nav-kind">${escapeHtml(g.navKind)}</span></div>
  <div class="nav-cards">${g.cards.map((c) => cardHtml(c, snapshots)).join("")}</div>
</section>`,
    )
    .join("");
}

function diagnosticsPanel(ir: NavGraphIR): string {
  if (ir.diagnostics.length === 0) return "";
  const rows = [...ir.diagnostics]
    .sort(
      (a, b) =>
        cmp(a.code, b.code) || cmp(a.file, b.file) || a.line - b.line || cmp(a.message, b.message),
    )
    .map((d) => {
      const detail = d.detail ? `<div class="diag-detail">${escapeHtml(d.detail)}</div>` : "";
      const loc = d.line > 0 ? `${escapeHtml(d.file)}:${d.line}` : escapeHtml(d.file);
      return `<li class="diag">
  <span class="diag-code">${escapeHtml(d.code)}</span>
  <div class="diag-body"><div class="diag-msg">${escapeHtml(
    d.message,
  )}</div><div class="diag-loc">${loc}</div>${detail}</div>
</li>`;
    })
    .join("");
  return `<details class="panel diagnostics" open>
  <summary>Diagnostics <span class="count">${ir.diagnostics.length}</span></summary>
  <ul class="diag-list">${rows}</ul>
</details>`;
}

/** Edge data handed to the client script for SVG overlay drawing. */
interface EdgeData {
  from: string;
  to: string;
  kind: NavEdge["kind"];
}

function edgeData(edges: readonly NavEdge[]): EdgeData[] {
  // Endpoints (routePaths) are what the client matches to cards; line numbers are
  // irrelevant to presentation. Sorted for stable embedded output.
  return [...edges]
    .map((e) => ({ from: e.from, to: e.to, kind: e.kind }))
    .sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind));
}

function countEdges(edges: readonly NavEdge[], kind: NavEdge["kind"]): number {
  return edges.filter((e) => e.kind === kind).length;
}

function countDestinations(navigators: readonly NavigatorNode[]): number {
  let n = 0;
  const walk = (nav: NavigatorNode): void => {
    n += nav.destinations.length;
    nav.children.forEach(walk);
  };
  navigators.forEach(walk);
  return n;
}

/**
 * Render an IR (and optional snapshots) to a complete standalone HTML document string.
 * With no snapshots every destination is a param card; the document is still shippable.
 */
export function renderHtml(
  ir: NavGraphIR,
  snapshots: SnapshotMap = {},
  options: RenderOptions = {},
): string {
  const title = options.title ?? "wirenav — navigation graph";
  const { columns } = place(ir.navigators);

  const columnsHtml = columns
    .map(
      (cards, depth) => `<div class="column" data-depth="${depth}">
  <div class="column-head">layer ${depth}</div>
  ${navGroupsForColumn(cards, snapshots)}
</div>`,
    )
    .join("");

  const declaredCount = countEdges(ir.edges, "declared");
  const inferredCount = countEdges(ir.edges, "inferred");
  const destCount = countDestinations(ir.navigators);
  const routerLabel = `${ir.router.name}@${ir.router.major}`;

  const edgesJson = escapeJsonForScript(edgeData(ir.edges));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="wirenav render-html" />
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="topbar">
  <div class="brand">wirenav</div>
  <div class="meta">
    <span class="chip chip-router">${escapeHtml(routerLabel)}</span>
    <span class="chip">format v${ir.formatVersion}</span>
    <span class="chip">${destCount} destinations</span>
    <span class="chip">${declaredCount} declared</span>
    <span class="chip">${inferredCount} inferred</span>
    <span class="chip">${ir.diagnostics.length} diagnostics</span>
  </div>
  <div class="controls">
    <button id="zoom-out" title="Zoom out" type="button">−</button>
    <button id="zoom-reset" title="Reset view" type="button">reset</button>
    <button id="zoom-in" title="Zoom in" type="button">+</button>
  </div>
</header>
<div class="legend">
  <span class="lg"><span class="line solid"></span>declared edge</span>
  <span class="lg"><span class="line dashed"></span>inferred edge</span>
  <span class="lg"><span class="swatch k-stack"></span>stack</span>
  <span class="lg"><span class="swatch k-tabs"></span>tabs</span>
  <span class="lg"><span class="swatch k-drawer"></span>drawer</span>
  <span class="lg"><span class="swatch k-slot"></span>slot</span>
  <span class="lg"><span class="swatch k-unknown"></span>unknown</span>
</div>
<div id="viewport">
  <div id="canvas">
    <svg id="edges" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="columns">${columnsHtml}</div>
  </div>
</div>
${diagnosticsPanel(ir)}
<script id="edge-data" type="application/json">${edgesJson}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}
