/**
 * scripts/__tests__/enterwith-ban.test.ts (Phase 19 / Plan 19-08 / D-24 / D-25 / D-26 / B5)
 *
 * Three-layer enterWith ban self-test.
 *
 * Layer 1 (Biome GritQL rule at `.biome/plugins/no-als-enter-with.grit`):
 *   - B5 red-path test below runs `bunx biome check <fixture>` and asserts
 *     non-zero exit AND `no-async-local-storage-enterWith` rule id + the
 *     "banned (CTX-01)" message appear on output.
 *
 * Layer 2 (grep-based bash script at `scripts/lint-no-enterwith.sh`):
 *   - Green path: exits 0 against the post-Plan-01 clean repo.
 *   - Red path: creates a temporary non-allow-listed file containing a mocked
 *     `.enterWith(` call, runs the script, asserts non-zero exit + the path
 *     is listed; then deletes the temp file.
 *
 * Layer 3 (in-test full-repo grep assertion):
 *   - Asserts that `grep -rn ".enterWith(" packages/ apps/ --include="*.ts"
 *     --include="*.tsx"` matches ONLY the allow-listed fixture file, and
 *     nothing else across the monorepo.
 *
 * ---
 *
 * Test-file self-flag discipline (19-01/19-03 pattern):
 *   The in-test grep fires against `.enterWith(` as a literal substring in
 *   repository source files. This test file MUST NOT self-flag. All
 *   literal occurrences of the banned token in assertion strings or
 *   regex patterns are built via dynamic token construction so the
 *   literal substring `.enterWith(` never appears in this file's source.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Dynamic-token construction for the banned literal so THIS test file does
// not self-flag on the grep / plugin gate.
const BANNED_METHOD = `${"enter"}${"With"}`; // -> "enterWith"
const BANNED_TOKEN = `.${BANNED_METHOD}(`; // -> ".enterWith("

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURE_PATH =
  "packages/observability/src/__tests__/__fixtures__/enterwith-violation.ts";
const FIXTURE_ABS = join(REPO_ROOT, FIXTURE_PATH);

// Red-path temp fixture MUST use a `.ts` suffix (not `.ts.tmp`) so the grep
// script's `--include="*.ts"` filter matches it. The file is kept out of
// TypeScript project scope by the `@ts-nocheck` pragma inside the file.
const TMP_FIXTURE_REL =
  "packages/observability/src/__tests__/__enterwith_red_path_fixture_tmp__.ts";
const TMP_FIXTURE_ABS = join(REPO_ROOT, TMP_FIXTURE_REL);

afterAll(() => {
  try {
    unlinkSync(TMP_FIXTURE_ABS);
  } catch {
    // ignore — test may have already cleaned up
  }
});

describe("CTX-01 three-layer enterWith ban (Plan 19-08 / D-24 / D-25 / D-26)", () => {
  test("repo has zero banned-token occurrences in packages/ or apps/ outside the fixture allow-list", async () => {
    const result = await $`grep -rn ${BANNED_TOKEN} packages/ apps/ --include=${"*.ts"} --include=${"*.tsx"}`
      .nothrow()
      .cwd(REPO_ROOT)
      .text();
    const nonFixtureMatches = result
      .trim()
      .split("\n")
      .filter((line) => line.length > 0 && !line.includes(FIXTURE_PATH));
    expect(nonFixtureMatches).toEqual([]);
  });

  test("scripts/lint-no-enterwith.sh exits 0 against clean tree (fixture allow-listed)", async () => {
    expect(existsSync(FIXTURE_ABS)).toBe(true);
    const proc = await $`bash scripts/lint-no-enterwith.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).toBe(0);
  });

  test("scripts/lint-no-enterwith.sh exits non-zero when a NON-allow-listed file adds a banned call", async () => {
    // Build a source line that contains the banned literal dynamically so
    // this test file's source does not itself contain the literal token.
    const offender = [
      "// Temporary fixture — Phase 19 Plan 08 grep-gate red-path test.",
      "// @ts-nocheck",
      "const fakeAls = { [" +
        JSON.stringify(BANNED_METHOD) +
        "]: (_: unknown) => {} };",
      `fakeAls${BANNED_TOKEN}{ tenantId: "TEST_FIXTURE_SHOULD_FAIL_LINT" });`,
      "",
    ].join("\n");
    writeFileSync(TMP_FIXTURE_ABS, offender);

    const proc = await $`bash scripts/lint-no-enterwith.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).not.toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("__enterwith_red_path_fixture_tmp__.ts");

    unlinkSync(TMP_FIXTURE_ABS);
  });

  // B5 — the mandatory "Biome rule actually fires on the fixture" gate.
  test("B5: Biome GritQL rule fires on the red-path fixture (exit != 0 + rule id + message on output)", async () => {
    expect(existsSync(FIXTURE_ABS)).toBe(true);
    const proc = await $`bunx biome check ${FIXTURE_PATH}`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    const out = proc.stdout.toString() + proc.stderr.toString();

    // (a) Biome must exit non-zero on the violation.
    expect(proc.exitCode).not.toBe(0);
    // (b) The rule id must appear on output — proves the GritQL rule actually
    //     fired (not just that Biome found some OTHER issue in the fixture).
    expect(out).toContain("no-async-local-storage-enterWith");
    // (c) The rule message marker (partial, excluding the banned literal).
    expect(out).toContain("banned (CTX-01)");
  });
});
