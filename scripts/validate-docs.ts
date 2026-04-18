#!/usr/bin/env bun
/**
 * Phase 15 docs validator.
 *
 * Runs at phase close. Asserts three invariants across the developer docs
 * under `docs/`:
 *   1. No forbidden imports: the string `@baseworks/test-utils` MUST NOT appear
 *      anywhere under docs/ (no such workspace package exists -- see Plan 15-04
 *      revision). All test-utils imports in docs use relative paths.
 *   2. No leaked secrets of common provider shapes: `sk_live_`, `sk_test_{24+}`,
 *      `re_{20+}`, `whsec_{24+}`.
 *   3. Mermaid coverage floor: per D-01, at least 8 Mermaid fenced code blocks
 *      appear across docs/ (4 architecture diagrams + 4 integration sequenceDiagrams).
 *
 * Exit code 0 on success, 1 on any failure. All failures print to stderr.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Use fileURLToPath so Windows gets "C:\\Projetos\\baseworks" (no leading slash).
// The raw `.pathname` form yields "/C:/Projetos/baseworks/" which Bun.Glob
// cannot open as a cwd on Win32.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const docsGlob = new Bun.Glob("docs/**/*.md");

const forbiddenImport = /@baseworks\/test-utils/g;
const secretShapes: Array<{ name: string; re: RegExp }> = [
  { name: "Stripe live", re: /sk_live_[A-Za-z0-9]+/g },
  { name: "Stripe test", re: /sk_test_[A-Za-z0-9]{24,}/g },
  { name: "Resend",      re: /re_[A-Za-z0-9]{20,}/g },
  { name: "Webhook",     re: /whsec_[A-Za-z0-9]{24,}/g },
];
const mermaidFence = /^```mermaid$/gm;

let failures = 0;
let mermaidTotal = 0;

for await (const relPath of docsGlob.scan({ cwd: ROOT })) {
  const full = join(ROOT, relPath);
  const text = await readFile(full, "utf8");

  // (1) Forbidden import
  const forbidden = text.match(forbiddenImport);
  if (forbidden && forbidden.length > 0) {
    console.error(
      `[validate-docs] FAIL: ${relPath} contains forbidden string "@baseworks/test-utils" (${forbidden.length}x). Use the relative path "../../../__test-utils__/..." instead.`,
    );
    failures++;
  }

  // (2) Leaked secret shapes
  for (const { name, re } of secretShapes) {
    const matches = text.match(re);
    if (matches && matches.length > 0) {
      console.error(
        `[validate-docs] FAIL: ${relPath} contains ${name}-shaped string (${matches.length}x). Use short placeholders (e.g. "sk_test_replace_me", "re_replace_me").`,
      );
      failures++;
    }
  }

  // (3) Count Mermaid fences (accumulate across all docs)
  const fences = text.match(mermaidFence);
  if (fences) mermaidTotal += fences.length;
}

// Mermaid floor: D-01 specifies 4 architecture + 4 integration diagrams = 8 minimum.
if (mermaidTotal < 8) {
  console.error(
    `[validate-docs] FAIL: found ${mermaidTotal} Mermaid fenced blocks across docs/; D-01 requires at least 8 (4 in docs/architecture.md + 1 per integration doc).`,
  );
  failures++;
} else {
  console.log(`[validate-docs] OK: found ${mermaidTotal} Mermaid fenced blocks across docs/ (>= 8 required).`);
}

if (failures > 0) {
  console.error(`[validate-docs] ${failures} failure(s). Exit 1.`);
  process.exit(1);
}
console.log("[validate-docs] PASS");
