/**
 * scripts/__tests__/runbook-files-present.test.ts (Phase 23 / Plan 23-01 / Task 3)
 *
 * DOC-03 9-runbook coverage gate. Asserts that every slug in `_slugs.ts`
 * has a corresponding `docs/runbooks/<slug>.md` file.
 *
 * Wave-0 RED state: all 9 tests fail today because docs/runbooks/ does not
 * exist yet. The tests go GREEN as Plan 23-03 lands. This is intentional —
 * the test scaffolds are committed in Wave 0 so Plan 23-03's diff cannot
 * silently miss a slug.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNBOOK_SLUGS } from "./_slugs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

for (const slug of RUNBOOK_SLUGS) {
  test(`runbook docs/runbooks/${slug}.md exists`, () => {
    expect(existsSync(join(ROOT, "docs/runbooks", `${slug}.md`))).toBe(true);
  });
}
