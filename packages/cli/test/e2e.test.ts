/**
 * End-to-end smoke test: run the REAL `wirenav` binary as a subprocess against the
 * nested-groups fixture. This is the first test of wirenav as a product (a spawned CLI),
 * not as libraries — so it deliberately builds and executes `dist/index.js` rather than
 * importing functions.
 *
 * Flow: dump a baseline → mutate a copy of the app (add a screen) → check (expect exit 1
 * + a drift report) → render (expect a standalone HTML file). Everything runs in an
 * os.tmpdir copy so the repo tree is never touched.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const cliDist = join(here, "..", "dist", "index.js");
const fixtureSrc = join(repoRoot, "fixtures", "expo-router-latest-nested-groups");
const exampleApp = join(repoRoot, "apps", "example-latest");

let work: string;

/**
 * Run the built binary. Captures BOTH streams regardless of exit code (diagnostics go to
 * stderr even on a successful exit 0, so we must not drop it).
 */
function wirenav(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("node", [cliDist, ...args], { encoding: "utf8" });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

beforeAll(() => {
  // Build wirenav AND its workspace dependencies (core, extract-expo-router, render-html).
  execFileSync("pnpm", ["--filter", "wirenav...", "build"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  work = mkdtempSync(join(tmpdir(), "wirenav-e2e-"));
  cpSync(fixtureSrc, join(work, "app-under-test"), { recursive: true });
}, 180_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("wirenav CLI end-to-end (nested-groups fixture)", () => {
  const project = () => join(work, "app-under-test");
  const baseline = () => join(work, "wirenav.nav");

  it("dump writes a deterministic .nav baseline matching the golden", () => {
    const res = wirenav(["dump", project(), "--out", baseline()]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("wrote");

    const produced = readFileSync(baseline(), "utf8");
    const golden = readFileSync(join(fixtureSrc, "expected.nav"), "utf8");
    expect(produced).toBe(golden);
  });

  it("check on the unmodified app reports no drift and exits 0", () => {
    const res = wirenav(["check", project(), "--baseline", baseline()]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("no navigation drift");
  });

  it("check after adding a screen reports drift and exits 1", () => {
    // Mutate: add a new route. This is an added destination ⇒ failing drift.
    writeFileSync(
      join(project(), "app", "settings.tsx"),
      "export default function Settings() { return null; }\n",
    );
    const res = wirenav(["check", project(), "--baseline", baseline()]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("navigation drift detected");
    expect(res.stdout).toContain("added destinations");
    expect(res.stdout).toContain("/settings");
  });

  it("check --json emits the structured verdict with exit 1", () => {
    const res = wirenav(["check", project(), "--baseline", baseline(), "--json"]);
    expect(res.status).toBe(1);
    const payload = JSON.parse(res.stdout) as {
      verdict: { hasFailingDrift: boolean; exitCode: number };
      diff: { destinations: { added: { routePath: string }[] } };
    };
    expect(payload.verdict.hasFailingDrift).toBe(true);
    expect(payload.verdict.exitCode).toBe(1);
    expect(payload.diff.destinations.added.some((a) => a.routePath === "/settings")).toBe(true);
  });

  it("render writes a standalone HTML file containing every destination", () => {
    const out = join(work, "graph.html");
    const res = wirenav(["render", project(), "--out", out]);
    expect(res.status).toBe(0);

    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    // The mutated app now includes /settings alongside the original routes.
    for (const id of [
      "app/index.tsx",
      "app/(marketing)/about.tsx",
      "app/(marketing)/(promo)/deal.tsx",
      "app/settings.tsx",
    ]) {
      expect(html, `missing ${id}`).toContain(id);
    }
    expect(html).not.toMatch(/src="https?:/);
  });

  it("errors with guidance (exit 2) on a directory with no supported router", () => {
    // `dump` extracts immediately (no baseline to read first), so it surfaces the
    // detection guidance directly.
    const empty = mkdtempSync(join(tmpdir(), "wirenav-empty-"));
    writeFileSync(join(empty, "package.json"), JSON.stringify({ name: "x" }));
    const res = wirenav(["dump", empty, "--out", join(empty, "out.nav")]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("could not detect a supported router");
    rmSync(empty, { recursive: true, force: true });
  });

  it("dump reports an unwritable --out as a clean one-line error (exit 2, no stack)", () => {
    const badOut = join(work, "no-such-dir", "out.nav");
    const res = wirenav(["dump", project(), "--out", badOut]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain(`could not write ${badOut}`);
    expect(res.stderr).not.toContain("unexpected error");
  });

  it("errors (exit 2) with a v0.2 note when only react-navigation is present", () => {
    const rn = mkdtempSync(join(tmpdir(), "wirenav-rn-"));
    writeFileSync(
      join(rn, "package.json"),
      JSON.stringify({ name: "x", dependencies: { "@react-navigation/native": "^7.0.0" } }),
    );
    const res = wirenav(["dump", rn, "--out", join(rn, "out.nav")]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("v0.2");
    rmSync(rn, { recursive: true, force: true });
  });
});

/**
 * Dogfood drift-gate: the committed apps/example-latest/wirenav.nav must match a fresh
 * static extraction of that app. Runs against the REAL repo tree (not a tmp copy) so it
 * fails CI if the app's routes change without a baseline regen. Extraction is static, so
 * this needs no node_modules install (the app's Expo deps are irrelevant here).
 */
describe("dogfood drift-gate (apps/example-latest)", () => {
  const baseline = join(exampleApp, "wirenav.nav");

  it("check on the committed baseline reports no drift (exit 0)", () => {
    const res = wirenav(["check", exampleApp, "--baseline", baseline]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("no navigation drift");
    // The intentional runtime-navigation case must keep surfacing as a diagnostic.
    expect(res.stderr).toContain("WN202");
  });

  it("render produces a standalone graph covering every route, both edge kinds", () => {
    const out = join(work, "example.html");
    const res = wirenav(["render", exampleApp, "--out", out]);
    expect(res.status).toBe(0);
    const html = readFileSync(out, "utf8");
    for (const id of [
      "app/index.tsx",
      "app/+not-found.tsx",
      "app/user/[id].tsx",
      "app/blog/[...slug].tsx",
      "app/(tabs)/feed.tsx",
      "app/(marketing)/(promo)/deal.tsx",
    ]) {
      expect(html, `missing ${id}`).toContain(id);
    }
    expect(html).toContain('"kind":"declared"');
    expect(html).toContain('"kind":"inferred"');
    expect(html).not.toMatch(/src="https?:/);
  });
});
