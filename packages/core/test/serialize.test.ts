import { describe, expect, it } from "vitest";
import { canonicalizeParamType, serialize } from "../src/serialize.js";
import type { NavGraphIR } from "../src/ir.js";
import { dest, edge, graph, nav, param } from "./helpers.js";

/**
 * Build the same logical graph twice with deliberately different insertion order for
 * navigators, destinations, params, edges, and diagnostics. Determinism requires
 * byte-identical serialization regardless of that order.
 */
function buildShuffledA(): NavGraphIR {
  return graph({
    diagnostics: [
      {
        code: "WN101",
        message: "dynamic route name not statically resolvable",
        file: "src/hooks/useNav.ts",
        line: 23,
      },
      { code: "WN104", message: "unrecognized router version", file: "package.json", line: 4 },
    ],
    edges: [
      edge("/feed", "/profile", "declared", "app/(tabs)/feed.tsx", 18),
      edge("/login", "/", "declared", "app/login.tsx", 42),
      edge("/profile", "/login", "inferred", "app/(tabs)/profile.tsx", 77),
    ],
    navigators: [
      nav({
        name: "app",
        kind: "stack",
        destinations: [
          dest({ id: "app/login.tsx", routePath: "/login" }),
          dest({ id: "app/index.tsx", routePath: "/" }),
        ],
        children: [
          nav({
            name: "(tabs)",
            kind: "tabs",
            file: "app/(tabs)/_layout.tsx",
            destinations: [
              dest({
                id: "app/(tabs)/profile.tsx",
                routePath: "/profile",
                params: [param("tab", "'posts' | 'likes'", true), param("userId", "string")],
              }),
              dest({ id: "app/(tabs)/feed.tsx", routePath: "/feed" }),
            ],
          }),
        ],
      }),
    ],
  });
}

/** Same graph, every array reversed / permuted relative to A. */
function buildShuffledB(): NavGraphIR {
  return graph({
    diagnostics: [
      { code: "WN104", message: "unrecognized router version", file: "package.json", line: 4 },
      {
        code: "WN101",
        message: "dynamic route name not statically resolvable",
        file: "src/hooks/useNav.ts",
        line: 23,
      },
    ],
    edges: [
      edge("/profile", "/login", "inferred", "app/(tabs)/profile.tsx", 77),
      edge("/login", "/", "declared", "app/login.tsx", 42),
      edge("/feed", "/profile", "declared", "app/(tabs)/feed.tsx", 18),
    ],
    navigators: [
      nav({
        name: "app",
        kind: "stack",
        children: [
          nav({
            name: "(tabs)",
            kind: "tabs",
            file: "app/(tabs)/_layout.tsx",
            destinations: [
              dest({ id: "app/(tabs)/feed.tsx", routePath: "/feed" }),
              dest({
                id: "app/(tabs)/profile.tsx",
                routePath: "/profile",
                // params in the opposite order, optional-before-required
                params: [param("userId", "string"), param("tab", "'likes' | 'posts'", true)],
              }),
            ],
          }),
        ],
        destinations: [
          dest({ id: "app/index.tsx", routePath: "/" }),
          dest({ id: "app/login.tsx", routePath: "/login" }),
        ],
      }),
    ],
  });
}

describe("serialize determinism", () => {
  it("is byte-identical across shuffled insertion order", () => {
    expect(serialize(buildShuffledA())).toBe(serialize(buildShuffledB()));
  });

  it("produces the expected v1 shape", () => {
    expect(serialize(buildShuffledA())).toBe(
      [
        "wirenav-format: 1",
        "router: expo-router@5",
        "",
        "navigator app [stack]",
        "  destination / file=app/index.tsx",
        "  destination /login file=app/login.tsx",
        "  navigator (tabs) [tabs] file=app/(tabs)/_layout.tsx",
        "    destination /feed file=app/(tabs)/feed.tsx",
        "    destination /profile file=app/(tabs)/profile.tsx",
        "      param userId: string",
        "      param tab?: 'likes' | 'posts'",
        "",
        "edges declared",
        "  /feed -> /profile app/(tabs)/feed.tsx",
        "  /login -> / app/login.tsx",
        "",
        "edges inferred",
        "  /profile -> /login app/(tabs)/profile.tsx",
        "",
        "diagnostics",
        "  WN101 dynamic route name not statically resolvable src/hooks/useNav.ts",
        "  WN104 unrecognized router version package.json",
        "",
      ].join("\n"),
    );
  });

  it("ends with exactly one trailing newline", () => {
    const out = serialize(buildShuffledA());
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("keeps diagnostics differing only by line as two entries in the IR and --json", () => {
    // Text drops line numbers, so the two lines render identically — that collapse is
    // fine. What must NOT happen is deduplication in the IR / JSON representation.
    const ir = graph({
      diagnostics: [
        { code: "WN201", message: "duplicate route", file: "app/a.tsx", line: 3 },
        { code: "WN201", message: "duplicate route", file: "app/a.tsx", line: 9 },
      ],
    });
    expect(ir.diagnostics).toHaveLength(2);
    // --json representation (JSON.stringify round-trip) preserves both, with lines.
    const json = JSON.parse(JSON.stringify(ir)) as typeof ir;
    expect(json.diagnostics).toHaveLength(2);
    expect(json.diagnostics.map((d) => d.line).sort()).toEqual([3, 9]);
    // Text keeps both lines (identical) — collapsing to one would be a serializer bug.
    const wn201Lines = serialize(ir)
      .split("\n")
      .filter((l) => l.includes("WN201"));
    expect(wn201Lines).toHaveLength(2);
  });

  it("never writes Diagnostic.detail to the text format (kept in IR/--json only)", () => {
    const ir = graph({
      diagnostics: [
        {
          code: "WN202",
          message: "unresolvable navigation target",
          file: "app/index.tsx",
          line: 5,
          detail: "`/${a}/${b}`",
        },
      ],
    });
    const out = serialize(ir);
    expect(out).toContain("WN202 unresolvable navigation target app/index.tsx");
    expect(out).not.toContain("${a}");
    expect(out).not.toContain("detail");
    // detail survives in the IR / JSON view.
    expect(JSON.parse(JSON.stringify(ir)).diagnostics[0].detail).toBe("`/${a}/${b}`");
  });

  it("omits empty sections", () => {
    const out = serialize(graph());
    expect(out).toBe("wirenav-format: 1\nrouter: expo-router@5\n");
  });

  it("serializes destination flags in fixed order", () => {
    const out = serialize(
      graph({
        navigators: [
          nav({
            name: "app",
            kind: "stack",
            destinations: [
              dest({
                id: "app/+not-found.tsx",
                routePath: "/+not-found",
                flags: { special: "not-found", conditional: true },
              }),
            ],
          }),
        ],
      }),
    );
    expect(out).toContain(
      "destination /+not-found file=app/+not-found.tsx [conditional] [special:not-found]",
    );
  });

  it("serializes deep links sorted after params", () => {
    const out = serialize(
      graph({
        navigators: [
          nav({
            name: "app",
            kind: "stack",
            destinations: [
              dest({
                id: "app/profile.tsx",
                routePath: "/profile",
                params: [param("id", "string")],
                deepLinks: ["myapp://u/:id", "https://ex.com/profile/:id"],
              }),
            ],
          }),
        ],
      }),
    );
    const body = out.split("\n");
    const iParam = body.indexOf("    param id: string");
    const iLink = body.indexOf("    deeplink https://ex.com/profile/:id");
    expect(iParam).toBeGreaterThan(-1);
    expect(iLink).toBe(iParam + 1);
    expect(body[iLink + 1]).toBe("    deeplink myapp://u/:id");
  });
});

describe("canonicalizeParamType", () => {
  it("sorts union members alphabetically", () => {
    expect(canonicalizeParamType("'posts' | 'likes'")).toBe("'likes' | 'posts'");
    expect(canonicalizeParamType("'likes' | 'posts'")).toBe("'likes' | 'posts'");
  });

  it("normalizes double quotes to single quotes", () => {
    expect(canonicalizeParamType('"posts"|"likes"')).toBe("'likes' | 'posts'");
  });

  it("collapses duplicate members and normalizes whitespace", () => {
    expect(canonicalizeParamType("string |  string")).toBe("string");
    expect(canonicalizeParamType("number|string")).toBe("number | string");
  });

  it("leaves a plain type untouched", () => {
    expect(canonicalizeParamType("string")).toBe("string");
  });

  it("orders required params before optional in serialized output", () => {
    const out = serialize(
      graph({
        navigators: [
          nav({
            name: "app",
            kind: "stack",
            destinations: [
              dest({
                id: "app/s.tsx",
                routePath: "/s",
                params: [
                  param("zeta", "string", true),
                  param("alpha", "string", true),
                  param("yankee", "string"),
                  param("bravo", "string"),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    const params = out.split("\n").filter((l) => l.trim().startsWith("param "));
    expect(params).toEqual([
      "    param bravo: string",
      "    param yankee: string",
      "    param alpha?: string",
      "    param zeta?: string",
    ]);
  });
});
