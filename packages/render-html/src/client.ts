/**
 * Inline client script (vanilla, no framework). Two jobs:
 *  1. Pan/zoom the #canvas via pointer drag + wheel, plus toolbar buttons.
 *  2. Overlay navigation edges as SVG curves measured from the rendered card rectangles.
 *
 * Edges connect routePaths; a card is matched by its `data-route`. Endpoints with no card
 * on the canvas (e.g. a `@shared/...` source file that is not itself a destination) are
 * skipped for drawing — they still appear in the edge counts in the header.
 *
 * Emitted as a string so render.ts can inline it; kept in a function body so editors still
 * lint it. `String(fn)` + IIFE wrapping is done at module load.
 */
function clientMain(): void {
  const viewport = document.getElementById("viewport") as HTMLDivElement;
  const canvas = document.getElementById("canvas") as HTMLDivElement;
  const svg = document.getElementById("edges") as unknown as SVGSVGElement;
  const dataEl = document.getElementById("edge-data");
  const edges: { from: string; to: string; kind: "declared" | "inferred" }[] = dataEl
    ? JSON.parse(dataEl.textContent || "[]")
    : [];

  const state = { x: 24, y: 24, scale: 1 };

  function apply(): void {
    canvas.style.transform =
      "translate(" + state.x + "px," + state.y + "px) scale(" + state.scale + ")";
  }

  const SVGNS = "http://www.w3.org/2000/svg";

  // Match cards by routePath. First card wins on a routePath collision (presentation only).
  function cardByRoute(route: string): HTMLElement | null {
    return canvas.querySelector('.card[data-route="' + cssEscape(route) + '"]');
  }
  function cssEscape(v: string): string {
    if (window.CSS && CSS.escape) return CSS.escape(v);
    return v.replace(/["\\]/g, "\\$&");
  }

  function drawEdges(): void {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const cRect = canvas.getBoundingClientRect();
    const s = state.scale;
    // Canvas-local coordinates (undo the current transform) so the SVG, which lives inside
    // #canvas, scales together with the cards.
    const toLocal = (r: DOMRect) => ({
      left: (r.left - cRect.left) / s,
      right: (r.right - cRect.left) / s,
      top: (r.top - cRect.top) / s,
      cy: (r.top + r.height / 2 - cRect.top) / s,
    });

    for (const e of edges) {
      const a = cardByRoute(e.from);
      const b = cardByRoute(e.to);
      if (!a || !b) continue;
      const ra = toLocal(a.getBoundingClientRect());
      const rb = toLocal(b.getBoundingClientRect());
      // Exit the right edge of source, enter the left edge of target (fall back sensibly
      // when the target sits to the left).
      const x1 = ra.right;
      const y1 = ra.cy;
      const x2 = rb.left;
      const y2 = rb.cy;
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute(
        "d",
        "M " +
          x1 +
          " " +
          y1 +
          " C " +
          (x1 + dx) +
          " " +
          y1 +
          " " +
          (x2 - dx) +
          " " +
          y2 +
          " " +
          x2 +
          " " +
          y2,
      );
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", e.kind === "declared" ? "#58a6ff" : "#d29922");
      path.setAttribute("stroke-width", "1.6");
      if (e.kind === "inferred") path.setAttribute("stroke-dasharray", "5 4");
      path.setAttribute("opacity", "0.85");
      svg.appendChild(path);
    }
  }

  // --- Pan -------------------------------------------------------------------------
  let dragging = false;
  let sx = 0;
  let sy = 0;
  viewport.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest(".panel")) return;
    dragging = true;
    sx = ev.clientX - state.x;
    sy = ev.clientY - state.y;
    viewport.classList.add("panning");
    viewport.setPointerCapture(ev.pointerId);
  });
  viewport.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    state.x = ev.clientX - sx;
    state.y = ev.clientY - sy;
    apply();
  });
  const endPan = (): void => {
    dragging = false;
    viewport.classList.remove("panning");
  };
  viewport.addEventListener("pointerup", endPan);
  viewport.addEventListener("pointercancel", endPan);

  // --- Zoom (wheel, cursor-anchored) -----------------------------------------------
  viewport.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(2.5, Math.max(0.2, state.scale * factor));
      const ratio = next / state.scale;
      state.x = px - (px - state.x) * ratio;
      state.y = py - (py - state.y) * ratio;
      state.scale = next;
      apply();
    },
    { passive: false },
  );

  function zoomBy(factor: number): void {
    const rect = viewport.getBoundingClientRect();
    const px = rect.width / 2;
    const py = rect.height / 2;
    const next = Math.min(2.5, Math.max(0.2, state.scale * factor));
    const ratio = next / state.scale;
    state.x = px - (px - state.x) * ratio;
    state.y = py - (py - state.y) * ratio;
    state.scale = next;
    apply();
  }
  document.getElementById("zoom-in")?.addEventListener("click", () => zoomBy(1.2));
  document.getElementById("zoom-out")?.addEventListener("click", () => zoomBy(1 / 1.2));
  document.getElementById("zoom-reset")?.addEventListener("click", () => {
    state.x = 24;
    state.y = 24;
    state.scale = 1;
    apply();
  });

  apply();
  // Draw after layout settles; redraw on resize (card positions can reflow).
  requestAnimationFrame(drawEdges);
  window.addEventListener("resize", drawEdges);
}

/** The inlined script body: the function source wrapped in an IIFE. */
export const CLIENT_JS = "(" + clientMain.toString() + ")();";
