import { describe, expect, it } from "vitest";
import { serialize } from "../src/serialize.js";
import { parse, NavParseError } from "../src/parse.js";
import { dest, edge, graph, nav, param } from "./helpers.js";

const SAMPLE = serialize(
  graph({
    navigators: [
      nav({
        name: "app",
        kind: "stack",
        destinations: [
          dest({ id: "app/index.tsx", routePath: "/" }),
          dest({
            id: "app/login.tsx",
            routePath: "/login",
            flags: { special: "not-found" },
            deepLinks: ["myapp://login"],
          }),
        ],
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
                params: [param("userId", "string"), param("tab", "'likes' | 'posts'", true)],
                flags: { conditional: true },
              }),
            ],
          }),
        ],
      }),
    ],
    edges: [
      edge("/feed", "/profile", "declared", "app/(tabs)/feed.tsx", 18),
      edge("/login", "/", "declared", "app/login.tsx", 42),
      edge("/profile", "/login", "inferred", "app/(tabs)/profile.tsx", 77),
    ],
    diagnostics: [
      {
        code: "WN101",
        message: "dynamic route name not statically resolvable",
        file: "src/x.ts",
        line: 3,
      },
    ],
  }),
);

describe("round-trip", () => {
  it("serialize(parse(s)) === s for a full sample", () => {
    expect(serialize(parse(SAMPLE))).toBe(SAMPLE);
  });

  it("preserves nesting, flags, params, deep links, edges, diagnostics", () => {
    const ir = parse(SAMPLE);
    expect(ir.router).toEqual({ name: "expo-router", major: 5 });
    const app = ir.navigators[0]!;
    expect(app.name).toBe("app");
    expect(app.destinations.map((d) => d.routePath).sort()).toEqual(["/", "/login"]);
    const login = app.destinations.find((d) => d.routePath === "/login")!;
    expect(login.flags.special).toBe("not-found");
    expect(login.deepLinks).toEqual(["myapp://login"]);
    const tabs = app.children[0]!;
    expect(tabs.kind).toBe("tabs");
    expect(tabs.file).toBe("app/(tabs)/_layout.tsx");
    const profile = tabs.destinations.find((d) => d.routePath === "/profile")!;
    expect(profile.flags.conditional).toBe(true);
    expect(profile.params).toEqual([
      { name: "userId", optional: false, type: "string" },
      { name: "tab", optional: true, type: "'likes' | 'posts'" },
    ]);
    expect(ir.edges.filter((e) => e.kind === "declared")).toHaveLength(2);
    expect(ir.edges.filter((e) => e.kind === "inferred")).toHaveLength(1);
    expect(ir.diagnostics[0]!.code).toBe("WN101");
  });

  it("round-trips a header-only graph", () => {
    const s = serialize(graph());
    expect(serialize(parse(s))).toBe(s);
  });

  it("rejects an unsupported format version", () => {
    expect(() => parse("wirenav-format: 99\nrouter: expo-router@5\n")).toThrow(NavParseError);
  });

  it("rejects a malformed line", () => {
    expect(() => parse("wirenav-format: 1\nrouter: expo-router@5\n\ngarbage line\n")).toThrow(
      NavParseError,
    );
  });
});
