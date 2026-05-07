/**
 * scripts/__tests__/files-access-ban.test.ts (Phase 24 / Plan 24-07 / D-17)
 *
 * Two-layer no-direct-files-table-access ban self-test.
 *
 * Layer 1 (Biome GritQL rule at `.biome/plugins/ban-files-table-access.grit`):
 *   - B5 red-path test below runs `bunx biome check <fixture>` and asserts
 *     non-zero exit AND the `no-direct-files-table-access` rule id appears
 *     on output.
 *
 * Layer 2 (grep-based bash script at `scripts/lint-no-direct-files-access.sh`):
 *   - Green path: exits 0 against the post-Plan-07 clean repo (fixture allow-listed).
 *   - Red path: creates a temporary non-allow-listed file containing a mocked
 *     `db.select(...).from(files)` call, runs the script, asserts non-zero exit
 *     plus the temp path is listed; then deletes the temp file.
 *
 * Mirrors the structure of scripts/__tests__/enterwith-ban.test.ts — same
 * `bun.$` + `nothrow().quiet()` shape, same red-path-temp-file discipline.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURE_PATH =
  "scripts/__tests__/__fixtures__/direct-files-access-violation.ts";
const FIXTURE_ABS = join(REPO_ROOT, FIXTURE_PATH);

// Red-path temp fixture MUST live under packages/ or apps/ so the grep script
// finds it, MUST use `.ts` suffix to match the script's --include filter, and
// MUST be outside packages/modules/files/ (the allow-listed sanctioned path).
const TMP_FIXTURE_REL =
  "apps/api/src/__files_access_red_path_fixture_tmp__.ts";
const TMP_FIXTURE_ABS = join(REPO_ROOT, TMP_FIXTURE_REL);

afterAll(() => {
  try {
    unlinkSync(TMP_FIXTURE_ABS);
  } catch {
    // ignore — test may have already cleaned up
  }
});

describe("D-17 two-layer no-direct-files-table-access ban (Plan 24-07)", () => {
  test("fixture file exists at the allow-listed path", () => {
    expect(existsSync(FIXTURE_ABS)).toBe(true);
  });

  test("scripts/lint-no-direct-files-access.sh exits 0 against clean tree (fixture allow-listed)", async () => {
    const proc = await $`bash scripts/lint-no-direct-files-access.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).toBe(0);
  });

  test("scripts/lint-no-direct-files-access.sh exits non-zero when a NON-allow-listed file adds the banned pattern", async () => {
    const offender = [
      "// Temporary fixture — Phase 24 Plan 07 grep-gate red-path test.",
      "// @ts-nocheck",
      "declare const db: { select: (cols: unknown) => { from: (t: unknown) => unknown } };",
      "declare const files: unknown;",
      "const violation = db.select({ id: 1 }).from(files);",
      "void violation;",
      "",
    ].join("\n");
    writeFileSync(TMP_FIXTURE_ABS, offender);

    const proc = await $`bash scripts/lint-no-direct-files-access.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).not.toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("__files_access_red_path_fixture_tmp__.ts");

    unlinkSync(TMP_FIXTURE_ABS);
  });

  // B5 — the mandatory "Biome rule actually fires on the fixture" gate.
  test("B5: Biome GritQL rule fires on the red-path fixture (exit != 0 + rule id on output)", async () => {
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
    expect(out).toContain("no-direct-files-table-access");
  });
});
