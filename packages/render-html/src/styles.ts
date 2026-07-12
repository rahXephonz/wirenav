/** Inline stylesheet for the standalone graph document. Dark, dependency-free. */
export const STYLES = `
:root {
  --bg: #0d1117; --panel: #161b22; --panel-2: #1c2330; --line: #30363d;
  --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
  --declared: #58a6ff; --inferred: #d29922;
  --k-stack: #58a6ff; --k-tabs: #3fb950; --k-drawer: #bc8cff; --k-slot: #db6d28; --k-unknown: #8b949e;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font: 13px/1.45 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  display: flex; flex-direction: column; overflow: hidden;
}
.topbar {
  display: flex; align-items: center; gap: 16px; padding: 10px 16px;
  background: var(--panel); border-bottom: 1px solid var(--line); flex: none;
}
.brand { font-weight: 700; letter-spacing: .5px; color: var(--accent); }
.meta { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
.chip {
  background: var(--panel-2); border: 1px solid var(--line); border-radius: 999px;
  padding: 2px 10px; color: var(--muted); font-size: 12px;
}
.chip-router { color: var(--text); border-color: var(--accent); }
.controls { display: flex; gap: 6px; }
.controls button {
  background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit;
}
.controls button:hover { border-color: var(--accent); }
.legend {
  display: flex; gap: 16px; flex-wrap: wrap; padding: 6px 16px; flex: none;
  background: var(--panel); border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px;
}
.lg { display: inline-flex; align-items: center; gap: 6px; }
.line { width: 22px; height: 0; border-top: 2px solid var(--declared); display: inline-block; }
.line.dashed { border-top-style: dashed; border-color: var(--inferred); }
.swatch { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.k-stack { background: var(--k-stack); } .k-tabs { background: var(--k-tabs); }
.k-drawer { background: var(--k-drawer); } .k-slot { background: var(--k-slot); }
.k-unknown { background: var(--k-unknown); }

#viewport { flex: 1; overflow: hidden; position: relative; cursor: grab; }
#viewport.panning { cursor: grabbing; }
#canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; }
#edges { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; z-index: 0; }
#columns { position: relative; display: flex; gap: 64px; padding: 40px; align-items: flex-start; z-index: 1; }

.column { display: flex; flex-direction: column; gap: 24px; }
.column-head { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
.nav-group {
  border: 1px solid var(--line); border-left: 3px solid var(--k-unknown);
  border-radius: 10px; padding: 8px; background: rgba(255,255,255,.015);
}
.nav-group[data-kind=stack] { border-left-color: var(--k-stack); }
.nav-group[data-kind=tabs] { border-left-color: var(--k-tabs); }
.nav-group[data-kind=drawer] { border-left-color: var(--k-drawer); }
.nav-group[data-kind=slot] { border-left-color: var(--k-slot); }
.nav-label { display: flex; align-items: center; gap: 8px; margin: 2px 4px 8px; }
.nav-name { font-weight: 700; }
.nav-kind {
  font-size: 11px; color: var(--muted); border: 1px solid var(--line);
  border-radius: 4px; padding: 0 6px; text-transform: uppercase; letter-spacing: .5px;
}
.nav-cards { display: flex; flex-direction: column; gap: 12px; }

.card {
  width: 240px; background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; overflow: hidden;
}
.card-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--panel-2); }
.route { font-weight: 700; color: var(--text); word-break: break-all; }
.badges { display: flex; gap: 4px; margin-left: auto; }
.badge { font-size: 10px; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.badge-cond { background: #3a2d00; color: #e3b341; }
.badge-special { background: #3d1d00; color: #f0883e; }
.snap { background: #000; }
.snap img { display: block; width: 100%; height: auto; }
.snap-fallback { padding: 10px; color: var(--inferred); font-size: 11px; border-bottom: 1px solid var(--line); }
.card-body { padding: 8px 10px; }
.params { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.param { display: flex; justify-content: space-between; gap: 8px; }
.pname { color: var(--text); }
.opt { color: var(--inferred); }
.ptype { color: var(--accent); text-align: right; word-break: break-all; }
.no-params { color: var(--muted); font-size: 11px; margin-bottom: 6px; }
.deeplinks { list-style: none; margin: 0 0 6px; padding: 6px 0 0; border-top: 1px dashed var(--line); }
.deeplink { color: var(--k-drawer); font-size: 11px; word-break: break-all; }
.file { color: var(--muted); font-size: 10px; word-break: break-all; }

.panel {
  position: absolute; right: 12px; bottom: 12px; width: min(420px, 46vw); max-height: 42vh; overflow: auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; z-index: 5;
}
.panel summary { cursor: pointer; font-weight: 700; }
.panel .count { color: var(--muted); font-weight: 400; }
.diag-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.diag { display: flex; gap: 8px; }
.diag-code { color: var(--inferred); font-weight: 700; flex: none; }
.diag-msg { color: var(--text); }
.diag-loc { color: var(--muted); font-size: 11px; }
.diag-detail { color: var(--muted); font-size: 11px; margin-top: 2px; white-space: pre-wrap; word-break: break-all; }
`;
