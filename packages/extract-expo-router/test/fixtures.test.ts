import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { serialize } from "@wirenav/core";
import { extract } from "../src/index.js";

/**
 * Fixture + golden tests. Each `fixtures/expo-router-*` directory is a source-only
 * miniature app; the extractor runs against it and its serialized output is compared
 * byte-for-byte to the committed `expected.nav`. Run `pnpm goldens:update` (sets
 * UPDATE_GOLDENS=1) to regenerate goldens — then review the diff.
 */
const fixturesRoot = fileURLToPath(new URL("../../../fixtures", import.meta.url));
const shouldUpdate = process.env.UPDATE_GOLDENS === "1";

const fixtures = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith("expo-router-"))
  .map((e) => e.name)
  .sort();

describe("expo-router fixtures", () => {
  it("finds fixtures to test", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const name of fixtures) {
    it(name, () => {
      const dir = join(fixturesRoot, name);
      const actual = serialize(extract(dir));
      const goldenPath = join(dir, "expected.nav");
      if (shouldUpdate || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, actual);
      }
      expect(actual).toBe(readFileSync(goldenPath, "utf8"));
    });
  }
});
