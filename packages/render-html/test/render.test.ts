import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, type Destination, type NavGraphIR, type NavigatorNode } from "@wirenav/core";
import { renderHtml } from "../src/render.js";
import type { SnapshotMap } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "..", "..", "fixtures");

/** Every fixture that ships a golden `.nav` — the canonical corpus of extractor output. */
function goldenFixtures(): { name: string; ir: NavGraphIR }[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(FIXTURES, d.name, "expected.nav"))
    .filter((p) => existsSync(p))
    .map((p) => ({ name: p, ir: parse(readFileSync(p, "utf8")) }));
}

function allDestinations(ir: NavGraphIR): Destination[] {
  const out: Destination[] = [];
  const walk = (nav: NavigatorNode): void => {
    out.push(...nav.destinations);
    nav.children.forEach(walk);
  };
  ir.navigators.forEach(walk);
  return out;
}

const fixtures = goldenFixtures();

describe("renderHtml against the fixture goldens", () => {
  it("finds the fixture corpus", () => {
    // Guard: the corpus is 12 today; if this ever reads 0, the path is wrong, not the test.
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
  });

  for (const { name, ir } of fixtures) {
    it(`renders ${name} to standalone HTML with every destination id`, () => {
      const html = renderHtml(ir);
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("</html>");
      // Standalone: no external references of any kind.
      expect(html).not.toMatch(/src="https?:/);
      expect(html).not.toMatch(/<link[^>]+href=/);

      for (const dest of allDestinations(ir)) {
        expect(html, `missing destination id ${dest.id}`).toContain(dest.id);
      }
    });
  }
});

describe("renderHtml edge cases", () => {
  it("renders a header-only graph (no navigators) without crashing", () => {
    const ir = parse("wirenav-format: 1\nrouter: expo-router@5\n");
    const html = renderHtml(ir);
    expect(html).toContain("expo-router@5");
    expect(html).toContain("0 destinations");
  });

  it("embeds a diagnostics panel with WN codes and detail", () => {
    const ir: NavGraphIR = {
      formatVersion: 1,
      router: { name: "expo-router", major: 5 },
      navigators: [],
      edges: [],
      diagnostics: [
        {
          code: "WN104",
          message: "unrecognized version",
          file: "package.json",
          line: 0,
          detail: "declared: ^99.0.0",
        },
      ],
    };
    const html = renderHtml(ir);
    expect(html).toContain("WN104");
    expect(html).toContain("unrecognized version");
    expect(html).toContain("declared: ^99.0.0");
  });

  it("inlines an ok snapshot as an <img> and never references its file path", () => {
    const ir: NavGraphIR = {
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
          ],
        },
      ],
      edges: [],
      diagnostics: [],
    };
    const snapshots: SnapshotMap = {
      "app/index.tsx": {
        status: "ok",
        dataUri: "data:image/png;base64,AAAA",
        width: 100,
        height: 200,
        path: "/tmp/should-not-appear.png",
      },
    };
    const html = renderHtml(ir, snapshots);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain("should-not-appear.png");
  });

  it("shows a fallback note for an 'ok' snapshot that is missing its image data", () => {
    const ir: NavGraphIR = {
      formatVersion: 1,
      router: { name: "expo-router", major: 5 },
      navigators: [
        {
          kind: "stack",
          name: "app",
          children: [],
          destinations: [
            { id: "app/index.tsx", routePath: "/", params: [], deepLinks: [], flags: {} },
          ],
        },
      ],
      edges: [],
      diagnostics: [],
    };
    // A broken provider: status ok but no dataUri. Must not render a silent media-less card.
    const html = renderHtml(ir, { "app/index.tsx": { status: "ok" } });
    expect(html).toContain("preview ok: missing image data");
  });

  it("shows a fallback note (with reason) for a crashed snapshot", () => {
    const ir: NavGraphIR = {
      formatVersion: 1,
      router: { name: "expo-router", major: 5 },
      navigators: [
        {
          kind: "stack",
          name: "app",
          children: [],
          destinations: [
            { id: "app/index.tsx", routePath: "/", params: [], deepLinks: [], flags: {} },
          ],
        },
      ],
      edges: [],
      diagnostics: [],
    };
    const html = renderHtml(ir, {
      "app/index.tsx": { status: "crashed", diagnostic: "WN402 mount threw: boom" },
    });
    expect(html).toContain("preview crashed");
    expect(html).toContain("WN402 mount threw: boom");
  });
});
