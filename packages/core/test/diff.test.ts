import { describe, expect, it } from "vitest";
import { parse } from "../src/parse.js";
import { classifyDrift, diff, formatDiff, isClean } from "../src/diff.js";

const BASELINE = `wirenav-format: 1
router: expo-router@5

navigator app [stack]
  destination / file=app/index.tsx
  destination /login file=app/login.tsx
  destination /profile file=app/profile.tsx
    param userId: string
    param tab?: 'likes' | 'posts'

edges declared
  /login -> / app/login.tsx

edges inferred
  /profile -> /login app/profile.tsx
`;

function diffFrom(next: string) {
  return diff(parse(BASELINE), parse(next));
}

describe("differ — drift categories", () => {
  it("detects an added destination (failing)", () => {
    const d = diffFrom(
      BASELINE.replace(
        "  destination /login file=app/login.tsx\n",
        "  destination /login file=app/login.tsx\n  destination /settings file=app/settings.tsx\n",
      ),
    );
    expect(d.destinations.added.map((s) => s.routePath)).toEqual(["/settings"]);
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("detects a removed destination (failing)", () => {
    const d = diffFrom(BASELINE.replace("  destination /login file=app/login.tsx\n", ""));
    expect(d.destinations.removed.map((s) => s.routePath)).toEqual(["/login"]);
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("detects a changed param type (failing)", () => {
    const d = diffFrom(BASELINE.replace("'likes' | 'posts'", "'likes' | 'media' | 'posts'"));
    const change = d.destinations.changed.find((c) => c.routePath === "/profile")!;
    expect(change.params.changed).toEqual([
      { name: "tab", from: "?'likes' | 'posts'", to: "?'likes' | 'media' | 'posts'" },
    ]);
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("detects an added param (failing)", () => {
    const d = diffFrom(
      BASELINE.replace(
        "    param tab?: 'likes' | 'posts'\n",
        "    param tab?: 'likes' | 'posts'\n    param ref: string\n",
      ),
    );
    const change = d.destinations.changed.find((c) => c.routePath === "/profile")!;
    expect(change.params.added.map((p) => p.name)).toEqual(["ref"]);
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("detects a removed declared edge (failing)", () => {
    const d = diffFrom(BASELINE.replace("  /login -> / app/login.tsx\n", ""));
    expect(d.declaredEdges.removed).toHaveLength(1);
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("detects an added declared edge (failing)", () => {
    const d = diffFrom(
      BASELINE.replace(
        "  /login -> / app/login.tsx\n",
        "  /login -> / app/login.tsx\n  /profile -> / app/profile.tsx\n",
      ),
    );
    expect(d.declaredEdges.added.map((e) => `${e.from}->${e.to}`)).toEqual(["/profile->/"]);
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("does NOT treat a line shift as drift (line is not in the text format)", () => {
    // The baseline carries no line number; a fresh extraction with a real line for the
    // same (from, to, file) edge must diff clean.
    const base = parse(BASELINE);
    const fresh = parse(BASELINE);
    const edge = fresh.edges.find((e) => e.kind === "declared")!;
    edge.source.line = 999; // as if freshly extracted from a moved call site
    const d = diff(base, fresh);
    expect(d.declaredEdges.added).toHaveLength(0);
    expect(d.declaredEdges.removed).toHaveLength(0);
    expect(isClean(d)).toBe(true);
  });

  it("treats an added inferred edge as non-failing by default, failing under --strict-inferred", () => {
    const d = diffFrom(
      BASELINE.replace(
        "  /profile -> /login app/profile.tsx\n",
        "  /profile -> /login app/profile.tsx\n  /login -> /profile app/login.tsx\n",
      ),
    );
    expect(d.inferredEdges.added).toHaveLength(1);
    expect(classifyDrift(d).exitCode).toBe(0);
    expect(classifyDrift(d).hasInferredDrift).toBe(true);
    expect(classifyDrift(d, { strictInferred: true }).exitCode).toBe(1);
  });

  it("reports header (router) drift as informational only", () => {
    const d = diffFrom(BASELINE.replace("router: expo-router@5", "router: expo-router@6"));
    expect(d.header).toEqual({ from: "expo-router@5", to: "expo-router@6" });
    const v = classifyDrift(d);
    expect(v.exitCode).toBe(0);
    expect(v.hasInformationalDrift).toBe(true);
    expect(v.hasFailingDrift).toBe(false);
  });

  it("detects a routePath change under a stable id (failing)", () => {
    const d = diffFrom(
      BASELINE.replace(
        "  destination /login file=app/login.tsx\n",
        "  destination /signin file=app/login.tsx\n",
      ),
    );
    // Same id, new route → changed, not add+remove.
    expect(d.destinations.added).toHaveLength(0);
    expect(d.destinations.removed).toHaveLength(0);
    const change = d.destinations.changed.find((c) => c.id === "app/login.tsx")!;
    expect(change.routePathFrom).toBe("/login");
    expect(change.routePath).toBe("/signin");
    expect(classifyDrift(d).exitCode).toBe(1);
  });

  it("is clean when comparing a graph to itself", () => {
    const d = diffFrom(BASELINE);
    expect(isClean(d)).toBe(true);
    expect(classifyDrift(d).exitCode).toBe(0);
  });
});

describe("differ — formatting", () => {
  it('prints "no drift" for a clean diff', () => {
    expect(formatDiff(diffFrom(BASELINE))).toBe("✓ no navigation drift\n");
  });

  it("renders a grouped failing report", () => {
    const d = diffFrom(BASELINE.replace("'likes' | 'posts'", "'likes' | 'media' | 'posts'"));
    const report = formatDiff(d, { baseline: "wirenav.nav" });
    expect(report).toContain("✖ navigation drift detected (baseline: wirenav.nav)");
    expect(report).toContain("changed params (1)");
    expect(report).toContain(
      "~ /profile  param tab: ?'likes' | 'posts'  →  ?'likes' | 'media' | 'posts'",
    );
  });

  it("uses the warning marker for inferred-only drift", () => {
    const d = diffFrom(
      BASELINE.replace(
        "  /profile -> /login app/profile.tsx\n",
        "  /profile -> /login app/profile.tsx\n  /login -> /profile app/login.tsx\n",
      ),
    );
    const report = formatDiff(d);
    expect(report.startsWith("⚠ navigation drift detected")).toBe(true);
    expect(report).toContain("inferred-edge drift (1, non-failing by default)");
  });
});
