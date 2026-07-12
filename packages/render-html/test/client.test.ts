// @vitest-environment happy-dom
/**
 * Runtime smoke test for the INLINED client script (the one untested surface flagged in
 * review). We render a real graph, mount its body into a DOM, evaluate `CLIENT_JS` exactly
 * as the browser would (fn.toString() + IIFE), and assert the edge-overlay logic actually
 * draws an SVG <path> per *drawable* edge — proving the self-contained script parses, the
 * `document.getElementById` wiring lines up with render.ts's markup, and `cardByRoute`
 * matches routes including dynamic/catch-all segments.
 *
 * `drawEdges` runs on the `resize` listener the script installs, which fires synchronously
 * here (no reliance on requestAnimationFrame timing under happy-dom).
 */
import { describe, expect, it } from "vitest";
import type { NavGraphIR } from "@wirenav/core";
import { renderHtml } from "../src/render.js";
import { CLIENT_JS } from "../src/client.js";

function mountAndRun(html: string): void {
  const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  // Scripts injected via innerHTML do not execute — the client <script> is inert here and
  // the edge-data <script> survives as a readable element. We eval the client explicitly.
  document.body.innerHTML = body;
  new Function(CLIENT_JS)();
  window.dispatchEvent(new Event("resize"));
}

const IR: NavGraphIR = {
  formatVersion: 1,
  router: { name: "expo-router", major: 5 },
  navigators: [
    {
      kind: "stack",
      name: "app",
      file: "app/_layout.tsx",
      children: [],
      destinations: [
        { id: "app/index.tsx", routePath: "/", params: [], deepLinks: [], flags: {} },
        { id: "app/settings.tsx", routePath: "/settings", params: [], deepLinks: [], flags: {} },
        {
          id: "app/user/[id].tsx",
          routePath: "/user/[id]",
          params: [{ name: "id", optional: false, type: "string" }],
          deepLinks: [],
          flags: {},
        },
      ],
    },
  ],
  edges: [
    // Both endpoints are real destinations → drawable.
    { from: "/", to: "/settings", kind: "declared", source: { file: "app/index.tsx", line: 1 } },
    // Endpoint is a dynamic route → still a real card → drawable (route-matching stress).
    {
      from: "/settings",
      to: "/user/[id]",
      kind: "inferred",
      source: { file: "app/settings.tsx", line: 1 },
    },
    // Target has no card on the canvas → skipped (not an error).
    { from: "/", to: "/ghost", kind: "declared", source: { file: "app/index.tsx", line: 2 } },
  ],
  diagnostics: [],
};

describe("inlined client script (CLIENT_JS)", () => {
  it("draws one SVG path per drawable edge and skips endpoints with no card", () => {
    mountAndRun(renderHtml(IR));
    const paths = document.querySelectorAll("#edges path");
    // 2 of 3 edges connect two real cards; the /ghost target is skipped.
    expect(paths.length).toBe(2);
  });

  it("applies a transform to the canvas (pan/zoom wiring is live)", () => {
    mountAndRun(renderHtml(IR));
    const canvas = document.getElementById("canvas") as HTMLElement;
    expect(canvas.style.transform).toContain("scale(1)");
  });

  it("zoom-in button rescales without throwing", () => {
    mountAndRun(renderHtml(IR));
    (document.getElementById("zoom-in") as HTMLElement).click();
    const canvas = document.getElementById("canvas") as HTMLElement;
    expect(canvas.style.transform).toMatch(/scale\((?!1\))/); // scale != 1
  });
});
