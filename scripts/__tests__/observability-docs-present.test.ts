/**
 * scripts/__tests__/observability-docs-present.test.ts (Phase 23 / Plan 23-01 / Task 3)
 *
 * DOC-04 observability concept docs gate (D-05 four files):
 *   - docs/observability/README.md
 *   - docs/observability/attributes.md
 *   - docs/observability/cardinality.md
 *   - docs/observability/trace-propagation.md
 *
 * Plus: trace-propagation.md MUST contain exactly 2 Mermaid fenced blocks
 * (the W3C carrier flow diagram + the BullMQ producer/consumer link diagram —
 * Plan 23-02 owns this content and bumps the validator's Mermaid floor 8 → 11
 * in the same diff).
 *
 * Wave-0 RED state: 4 presence tests + 1 Mermaid-count test fail today. The
 * Mermaid-count test passes vacuously when trace-propagation.md is missing
 * (early return); presence is the gate. Both go GREEN as Plan 23-02 lands.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const OBS_FILES = ["README.md", "attributes.md", "cardinality.md", "trace-propagation.md"] as const;

for (const file of OBS_FILES) {
  test(`docs/observability/${file} exists`, () => {
    expect(existsSync(join(ROOT, "docs/observability", file))).toBe(true);
  });
}

test("docs/observability/trace-propagation.md contains exactly 2 Mermaid fenced blocks", () => {
  const path = join(ROOT, "docs/observability/trace-propagation.md");
  if (!existsSync(path)) return; // Wave-0 RED handled by presence test above.
  const text = readFileSync(path, "utf8");
  const fences = text.match(/^```mermaid$/gm);
  expect(fences?.length ?? 0).toBe(2);
});
