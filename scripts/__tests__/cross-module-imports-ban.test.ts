/**
 * scripts/__tests__/cross-module-imports-ban.test.ts (Phase 26 / SC#5 / MOD-02)
 *
 * Self-test for the no-cross-module-import ban
 * (scripts/lint-no-cross-module-imports.sh).
 *
 * The gate bans one feature module importing another via a package import
 * (`from "@baseworks/module-..."`) anywhere under a module's `src` directory.
 * The sanctioned cross-module channel is TypedEventBus (ctx.emit / eventBus.on).
 * Infra packages (@baseworks/shared, @baseworks/db, etc.) do not match the
 * `@baseworks/module-` prefix and pass automatically.
 *
 * Green path: exits 0 against the clean repo.
 * Red path: plants a temporary file under a module's `src` directory containing
 * a banned `from "@baseworks/module-billing"` import, runs the script, asserts
 * non-zero exit + the temp path is listed, then deletes the temp file.
 *
 * Mirrors scripts/__tests__/files-access-ban.test.ts — same `bun.$` +
 * `nothrow().quiet()` shape and red-path-temp-file discipline.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// Red-path temp fixture MUST live under a module's `src` directory so the grep
// script's `packages/modules/*/src` glob finds it, and MUST use `.ts` to match
// the script's --include filter.
const TMP_FIXTURE_REL = "packages/modules/example/src/__cross_module_red_path_fixture_tmp__.ts";
const TMP_FIXTURE_ABS = join(REPO_ROOT, TMP_FIXTURE_REL);

afterAll(() => {
  try {
    unlinkSync(TMP_FIXTURE_ABS);
  } catch {
    // ignore — test may have already cleaned up
  }
});

describe("SC#5 no-cross-module-import ban (Phase 26)", () => {
  test("scripts/lint-no-cross-module-imports.sh exits 0 against the clean tree", async () => {
    const proc = await $`bash scripts/lint-no-cross-module-imports.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).toBe(0);
  });

  test("scripts/lint-no-cross-module-imports.sh exits non-zero when a module imports another module", async () => {
    const offender = [
      "// Temporary fixture — Phase 26 SC#5 cross-module-ban red-path test.",
      "// @ts-nocheck",
      'import { something } from "@baseworks/module-billing";',
      "export const violation = something;",
      "",
    ].join("\n");
    writeFileSync(TMP_FIXTURE_ABS, offender);

    const proc = await $`bash scripts/lint-no-cross-module-imports.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).not.toBe(0);
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("__cross_module_red_path_fixture_tmp__.ts");

    unlinkSync(TMP_FIXTURE_ABS);
  });

  test("the ban allows infra-package imports (single-quote and double-quote forms pass)", async () => {
    const allowed = [
      "// Temporary fixture — Phase 26 SC#5 cross-module-ban green-path test.",
      "// @ts-nocheck",
      'import { ok } from "@baseworks/shared";',
      "import { getDb } from '@baseworks/db';",
      "export const x = ok;",
      "void getDb;",
      "",
    ].join("\n");
    writeFileSync(TMP_FIXTURE_ABS, allowed);

    const proc = await $`bash scripts/lint-no-cross-module-imports.sh`
      .cwd(REPO_ROOT)
      .nothrow()
      .quiet();
    expect(proc.exitCode).toBe(0);

    unlinkSync(TMP_FIXTURE_ABS);
  });
});
