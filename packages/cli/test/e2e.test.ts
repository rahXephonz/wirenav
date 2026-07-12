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
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const cliDist = join(here, "..", "dist", "index.js");
const fixtureSrc = join(repoRoot, "fixtures", "expo-router-latest-nested-groups");

let work: string;

/** Run the built binary. Returns {status, stdout, stderr}; never throws on non-zero exit. */
function wirenav(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [cliDist, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
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
