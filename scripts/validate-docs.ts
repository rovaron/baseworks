#!/usr/bin/env bun
import { existsSync } from "node:fs";
/**
 * Phase 15 + Phase 23 docs validator.
 *
 * Runs at phase close. Asserts four invariants across the developer docs
 * under `docs/`:
 *   1. No forbidden imports: the string `@baseworks/test-utils` MUST NOT appear
 *      anywhere under docs/ (no such workspace package exists -- see Plan 15-04
 *      revision). All test-utils imports in docs use relative paths.
 *   2. No leaked secrets of common provider shapes: `sk_live_`, `sk_test_{24+}`,
 *      `re_{20+}`, `whsec_{24+}`.
 *   3. Mermaid coverage floor: per D-01 (Phase 15) + D-06 (Phase 23), at least 11 Mermaid fenced code blocks appear across docs/ (4 architecture diagrams + 4 integration sequenceDiagrams + 2 trace-propagation + 1 obs README, with 1 buffer).
 *   4. runbook_url + cross-runbook markdown link integrity:
 *      - Every `runbook_url` field in `docs/alerts/sentry/*.json` MUST resolve to
 *        an existing file (validator does `JSON.parse(file).runbook_url` and
 *        existsSync on `join(ROOT, dirname(relPath), runbookUrl)`).
 *      - Every markdown link `[..](./foo.md)` or `[..](../foo/bar.md)` inside
 *        `docs/runbooks/*.md` MUST resolve to an existing `.md` file.
 *      Out of scope (per Phase 23 D-10): HTTP URLs, anchor-only links, links
 *      inside fenced code blocks (naïve line scan tolerates false-negatives there).
 *
 * Exit code 0 on success, 1 on any failure. All failures print to stderr.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Use fileURLToPath so Windows gets "C:\\Projetos\\baseworks" (no leading slash).
// The raw `.pathname` form yields "/C:/Projetos/baseworks/" which Bun.Glob
// cannot open as a cwd on Win32.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const docsGlob = new Bun.Glob("docs/**/*.md");

const forbiddenImport = /@baseworks\/test-utils/g;
const secretShapes: Array<{ name: string; re: RegExp }> = [
  { name: "Stripe live", re: /sk_live_[A-Za-z0-9]+/g },
  { name: "Stripe test", re: /sk_test_[A-Za-z0-9]{24,}/g },
  { name: "Resend", re: /re_[A-Za-z0-9]{20,}/g },
  { name: "Webhook", re: /whsec_[A-Za-z0-9]{24,}/g },
];
const mermaidFence = /^```mermaid$/gm;

// Pass A regex — capture relative `.md` link targets (./foo.md, ../bar/baz.md),
// optionally followed by a `#anchor` fragment we strip. HTTP URLs are excluded
// because the leading `./` or `../` is mandatory (out of scope per D-10).
const linkRegex = /\]\((\.\.?\/[\w/.-]+\.md)(?:#[\w-]+)?\)/g;

/**
 * Pass A — cross-runbook markdown link integrity.
 *
 * Returns one failure-message string per broken link inside the markdown text,
 * or an empty array when the relPath is outside `docs/runbooks/` (gate) or all
 * targets resolve. Caller increments the failure counter by `length`.
 *
 * @param relPath  Repo-relative path of the markdown file (e.g.
 *                 `docs/runbooks/db-down.md`). Used both for the gate check
 *                 and as the prefix of the emitted failure message.
 * @param text     Full text of the markdown file at `relPath`.
 * @param root     Absolute path of the repo root used to resolve link targets.
 *                 Pass `ROOT` from this module in the live validator path; tests
 *                 pass an arbitrary fixture root.
 *
 * Naïve line scan: links inside fenced code blocks are still scanned. D-10
 * explicit: that case is out of scope, false-negatives are tolerated, and tests
 * for fenced-code-block exclusion are NOT part of this invariant.
 */
export function checkCrossRunbookLinks(relPath: string, text: string, root: string): string[] {
  const failures: string[] = [];
  // Gate: only docs/runbooks/ markdown files are scanned. Other docs may have
  // broken cross-links — this invariant intentionally does not police them.
  if (relPath.startsWith("docs/runbooks/")) {
    let lineNum = 0;
    for (const line of text.split("\n")) {
      lineNum++;
      // Naïve line scan — links inside fenced code blocks are out of scope per D-10.
      for (const m of line.matchAll(linkRegex)) {
        const target = m[1];
        const resolved = join(root, dirname(relPath), target);
        if (!existsSync(resolved)) {
          failures.push(
            `[validate-docs] FAIL: ${relPath}:${lineNum}: ${target} → target not found at ${resolved}`,
          );
        }
      }
    }
  }
  return failures;
}

/**
 * Pass B — Sentry alert template `runbook_url` integrity.
 *
 * Returns one failure-message string when the JSON does not parse, the
 * `runbook_url` field is missing or non-string, or the resolved target does
 * not exist on disk. Returns null on success. Caller increments the failure
 * counter by 1 per non-null return.
 *
 * The validator hard-fails any file containing JS-style `// comments`
 * (D-15 misreading negative test) because `JSON.parse` rejects them.
 *
 * @param relPath  Repo-relative path of the JSON file (e.g.
 *                 `docs/alerts/sentry/db-down.json`). Used both for the
 *                 dirname-based target resolution and the emitted message.
 * @param jsonText Full text of the JSON file at `relPath`.
 * @param root     Absolute path of the repo root used to resolve `runbook_url`
 *                 relative to the JSON file's own directory.
 */
export function checkRunbookUrl(relPath: string, jsonText: string, root: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return `[validate-docs] FAIL: ${relPath}: not valid JSON (${String(err)})`;
  }
  const runbookUrl = (parsed as { runbook_url?: unknown }).runbook_url;
  if (typeof runbookUrl !== "string" || runbookUrl.length === 0) {
    return `[validate-docs] FAIL: ${relPath}: missing or non-string runbook_url field`;
  }
  const resolved = join(root, dirname(relPath), runbookUrl);
  if (!existsSync(resolved)) {
    return `[validate-docs] FAIL: ${relPath}: runbook_url "${runbookUrl}" → target not found at ${resolved}`;
  }
  return null;
}

// `import.meta.main` is true only when this file is the entrypoint
// (`bun scripts/validate-docs.ts`). When the test file imports the helpers
// via `import { … } from "../validate-docs"` the body below DOES NOT run,
// so the test does not spawn child processes or fail on its own corpus.
if (import.meta.main) {
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

    // (4a) Cross-runbook markdown links — only docs/runbooks/, README.md not in scope.
    const linkFailures = checkCrossRunbookLinks(relPath, text, ROOT);
    for (const f of linkFailures) console.error(f);
    failures += linkFailures.length;
  }

  // (4b) Sentry alert templates — runbook_url integrity.
  const sentryGlob = new Bun.Glob("docs/alerts/sentry/*.json");
  for await (const relPath of sentryGlob.scan({ cwd: ROOT })) {
    const full = join(ROOT, relPath);
    const text = await readFile(full, "utf8");
    const failure = checkRunbookUrl(relPath, text, ROOT);
    if (failure !== null) {
      console.error(failure);
      failures++;
    }
  }

  // Mermaid floor: D-01 (Phase 15) specified 4 architecture + 4 integration diagrams = 8 minimum.
  // D-06 (Phase 23) bumped the floor to 11 in lockstep with the two trace-propagation.md
  // diagrams + 1 docs/observability/README.md flowchart (Research Finding 5 — half-merged
  // state breaks CI; bump and diagrams must land atomically).
  if (mermaidTotal < 11) {
    console.error(
      `[validate-docs] FAIL: found ${mermaidTotal} Mermaid fenced blocks across docs/; floor is 11 (4 in docs/architecture.md + 1 per integration doc + 2 in docs/observability/trace-propagation.md + 1 in docs/observability/README.md, with 1 buffer).`,
    );
    failures++;
  } else {
    console.log(
      `[validate-docs] OK: found ${mermaidTotal} Mermaid fenced blocks across docs/ (>= 11 required).`,
    );
  }

  if (failures > 0) {
    console.error(`[validate-docs] ${failures} failure(s). Exit 1.`);
    process.exit(1);
  }
  console.log("[validate-docs] PASS");
}
