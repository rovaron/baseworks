/**
 * scripts/__tests__/runbook-no-screenshots.test.ts (Phase 23 / Plan 23-01 / Task 3)
 *
 * D-04 text-only invariant. Runbooks may include Mermaid (fenced as
 * ```mermaid…```) but MUST NOT include markdown image references
 * (`![alt](path)`). Screenshots drift faster than text and the canonical
 * runbook format stays text-only.
 *
 * Implementation note: fenced code blocks are stripped before the image-regex
 * scan so a literal `![alt](path)` inside a code fence does not false-positive.
 *
 * Wave-0 RED state: this test passes vacuously when the runbook file does not
 * exist (early return) — runbook-files-present.test.ts is the gate that catches
 * the missing-file case. This test goes GREEN once each runbook is authored
 * AND contains no images (or stays passing if the file remains missing).
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNBOOK_SLUGS } from "./_slugs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

for (const slug of RUNBOOK_SLUGS) {
  test(`runbook ${slug}.md has no markdown image refs`, () => {
    const path = join(ROOT, "docs/runbooks", `${slug}.md`);
    if (!existsSync(path)) return; // Wave-0 RED handled by runbook-files-present.test
    const text = readFileSync(path, "utf8");
    // Strip fenced code blocks (don't false-positive on Mermaid block fences in code).
    const stripped = text.replace(/```[\s\S]*?```/g, "");
    // Markdown image: ![alt](path) — D-04 forbids screenshots.
    const imageMatches = stripped.match(/!\[[^\]]*\]\([^)]+\)/g);
    expect(imageMatches ?? []).toEqual([]);
  });
}
