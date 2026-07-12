#!/usr/bin/env node
/**
 * wirenav CLI — detect router → extract → dump | check | render.
 *
 * This is the first place wirenav is a *product* rather than a set of libraries: it wires
 * the expo-router extractor to core's serializer/differ and to render-html. It legitimately
 * depends on an extractor (extractors are upstream of the CLI); nothing here leaks back into
 * core or an extractor.
 *
 * Exit codes:
 *   0  success / no failing drift
 *   1  `check` found failing navigation drift (the differ contract in nav-format.md)
 *   2  usage error, unsupported router, or I/O failure
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import {
  classifyDrift,
  diff,
  diffToJson,
  formatDiff,
  parse,
  serialize,
  type Diagnostic,
  type NavGraphIR,
} from "@wirenav/core";
import { extract } from "@wirenav/extract-expo-router";
import { renderHtml } from "@wirenav/render-html";
import { detectRouter } from "./detect.js";

const DEFAULT_NAV = "wirenav.nav";
const DEFAULT_HTML = "wirenav.html";

/** A controlled failure: message to stderr, process exits with `code`. */
class CliError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2 = 2,
  ) {
    super(message);
  }
}

function usage(): string {
  return [
    "wirenav — static React Native navigation graphs",
    "",
    "Usage:",
    "  wirenav dump   [path] [--out <file>]                     extract → write .nav baseline",
    "  wirenav check  [path] [--baseline <file>] [--json] [--strict-inferred]",
    "                                                           extract → diff vs baseline",
    "  wirenav render [path] [--out <file>]                     extract → standalone HTML",
    "",
    "  path            project root (default: current directory)",
    "  --out           output file (dump: wirenav.nav, render: wirenav.html)",
    "  --baseline      baseline .nav to diff against (default: wirenav.nav)",
    "  --json          machine-readable diff (check only)",
    "  --strict-inferred  treat inferred-edge drift as failing (check only)",
  ].join("\n");
}

/** Print diagnostics (with detail) to stderr, human-readable. Never affects stdout. */
function reportDiagnostics(diags: readonly Diagnostic[]): void {
  if (diags.length === 0) return;
  process.stderr.write(`\n${diags.length} diagnostic${diags.length === 1 ? "" : "s"}:\n`);
  for (const d of diags) {
    const loc = d.line > 0 ? `${d.file}:${d.line}` : d.file;
    process.stderr.write(`  ${d.code} ${d.message} (${loc})\n`);
    if (d.detail) process.stderr.write(`      ${d.detail}\n`);
  }
}

/** Detect the router and run the applicable extractor, or throw a guiding CliError. */
function extractProject(rootDir: string): NavGraphIR {
  const choice = detectRouter(rootDir);
  switch (choice.router) {
    case "expo-router":
      return extract(rootDir);
    case "react-navigation":
      throw new CliError(
        `react-navigation detected (${choice.packages.join(", ")}), but the ` +
          "react-navigation extractor is not yet supported — it is coming in v0.2. " +
          "For now only Expo Router (app/ directory + expo-router) can be analyzed.",
      );
    case "none":
      throw new CliError(
        "could not detect a supported router in " +
          `${rootDir}.\n` +
          `  app/ directory:   ${choice.hasAppDir ? "found" : "not found"}\n` +
          `  expo-router dep:  ${choice.hasExpoRouterDep ? "found" : "not found"}\n` +
          "Expo Router needs BOTH an app/ directory and an expo-router dependency in " +
          "package.json. react-navigation support arrives in v0.2.",
      );
  }
}

// --- Commands ------------------------------------------------------------------------

/** Write `content` to `out`, turning an IO failure into a clean one-line CliError. */
function writeOut(out: string, content: string): void {
  try {
    writeFileSync(out, content);
  } catch (err) {
    throw new CliError(`could not write ${out}: ${(err as Error).message}`);
  }
}

function cmdDump(rootDir: string, out: string): number {
  const ir = extractProject(rootDir);
  writeOut(out, serialize(ir));
  process.stdout.write(`wrote ${out}\n`);
  reportDiagnostics(ir.diagnostics);
  return 0;
}

function cmdRender(rootDir: string, out: string): number {
  const ir = extractProject(rootDir);
  // Empty SnapshotMap: cards-only, the release escape hatch. --snapshots lands later.
  writeOut(out, renderHtml(ir));
  process.stdout.write(`wrote ${out}\n`);
  reportDiagnostics(ir.diagnostics);
  return 0;
}

function cmdCheck(
  rootDir: string,
  baselinePath: string,
  opts: { json: boolean; strictInferred: boolean },
): number {
  let baselineText: string;
  try {
    baselineText = readFileSync(baselinePath, "utf8");
  } catch {
    throw new CliError(
      `baseline not found: ${baselinePath}. Run \`wirenav dump\` first to create it.`,
    );
  }

  let baseline: NavGraphIR;
  try {
    baseline = parse(baselineText);
  } catch (err) {
    throw new CliError(`failed to parse baseline ${baselinePath}: ${(err as Error).message}`);
  }

  const next = extractProject(rootDir);
  const d = diff(baseline, next);
  const driftOpts = { strictInferred: opts.strictInferred };
  const verdict = classifyDrift(d, driftOpts);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(diffToJson(d, driftOpts), null, 2)}\n`);
  } else {
    process.stdout.write(formatDiff(d, { ...driftOpts, baseline: baselinePath }));
  }
  // Diagnostics reflect the CURRENT extraction; always useful, printed to stderr.
  reportDiagnostics(next.diagnostics);
  return verdict.exitCode;
}

// --- Arg parsing / dispatch ----------------------------------------------------------

/** Parse the flags/positionals for a command. Inference gives `values.*` precise types. */
function parseCliArgs(rest: string[]) {
  try {
    return parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: "string" },
        baseline: { type: "string" },
        json: { type: "boolean", default: false },
        "strict-inferred": { type: "boolean", default: false },
      },
    });
  } catch (err) {
    throw new CliError(`${(err as Error).message}\n\n${usage()}`);
  }
}

function run(argv: string[]): number {
  const command = argv[0];
  // Explicit help → stdout, exit 0. No command at all → usage to stderr, exit 2 (an
  // error, so it must not pollute a piped stdout).
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!command) {
    process.stderr.write(`${usage()}\n`);
    return 2;
  }

  const rest = argv.slice(1);
  const parsed = parseCliArgs(rest);
  const rootDir = resolve(parsed.positionals[0] ?? ".");
  const values = parsed.values;

  switch (command) {
    case "dump":
      return cmdDump(rootDir, values.out ?? DEFAULT_NAV);
    case "render":
      return cmdRender(rootDir, values.out ?? DEFAULT_HTML);
    case "check":
      return cmdCheck(rootDir, values.baseline ?? DEFAULT_NAV, {
        json: Boolean(values.json),
        strictInferred: Boolean(values["strict-inferred"]),
      });
    default:
      throw new CliError(`unknown command: ${command}\n\n${usage()}`);
  }
}

function main(): void {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`wirenav: ${err.message}\n`);
      process.exitCode = err.code;
      return;
    }
    process.stderr.write(`wirenav: unexpected error: ${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 2;
  }
}

main();
