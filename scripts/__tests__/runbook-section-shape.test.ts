/**
 * scripts/__tests__/runbook-section-shape.test.ts (Phase 23 / Plan 23-01 / Task 3)
 *
 * DOC-03 5-section template gate. Each runbook MUST contain exactly the
 * five canonical level-2 headings (`## Trigger`, `## Symptoms`, `## Triage`,
 * `## Resolution`, `## Escalation`) in that order. Other level-2 headings
 * are tolerated (subsections are level-3+ and ignored by this gate).
 *
 * Wave-0 RED state: all 9 tests fail today because the runbook files do not
 * exist yet. The Wave-0 RED branch (when the file is missing) emits a clear
 * "<path>" did not equal "authored" diagnostic so the failure is human-readable.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNBOOK_SLUGS } from "./_slugs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const REQUIRED_SECTIONS = ["Trigger", "Symptoms", "Triage", "Resolution", "Escalation"] as const;
type RequiredSection = (typeof REQUIRED_SECTIONS)[number];

for (const slug of RUNBOOK_SLUGS) {
  test(`runbook ${slug}.md has all 5 required ## level-2 sections in order`, () => {
    const path = join(ROOT, "docs/runbooks", `${slug}.md`);
    if (!existsSync(path)) {
      // Wave-0 RED: file not yet authored. Mark the assertion failure explicitly.
      expect(`docs/runbooks/${slug}.md`).toBe("authored");
      return;
    }
    const text = readFileSync(path, "utf8");
    const headingsInOrder: string[] = [];
    for (const line of text.split("\n")) {
      const m = line.match(/^##\s+([A-Za-z][A-Za-z0-9 ]*)\s*$/);
      if (m) headingsInOrder.push(m[1]);
    }
    // Filter to just the canonical-section headings (ignore subsections / extra ## blocks).
    const found = headingsInOrder.filter((h): h is RequiredSection =>
      (REQUIRED_SECTIONS as readonly string[]).includes(h),
    );
    expect(found).toEqual([...REQUIRED_SECTIONS]);
  });
}
