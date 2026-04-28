/**
 * scripts/__tests__/validate-docs.test.ts (Phase 23 / Plan 23-01 / Task 1)
 *
 * Tests for the 4th invariant (DOC-03 / DOC-04 — runbook_url integrity +
 * cross-runbook markdown link integrity) of `scripts/validate-docs.ts`.
 *
 * The 4th invariant is implemented as two pure helpers exported from the
 * validator script so this test file can exercise them directly without
 * subprocess spawning:
 *   - checkCrossRunbookLinks(mdRelPath, text, root): string[] — Pass A
 *   - checkRunbookUrl(jsonRelPath, jsonText, root): string | null — Pass B
 *
 * Test 7 ("full corpus passes today") is implemented as a subprocess invocation
 * because it asserts the complete CLI exit semantics, not just helper return
 * values. See the bottom of the file.
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  checkCrossRunbookLinks,
  checkRunbookUrl,
} from "../validate-docs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE_RUNBOOK_REL = "scripts/__tests__/fixtures/runbooks/example.md";
const FIXTURE_GOOD_RUNBOOK_REL = "scripts/__tests__/fixtures/runbooks/good.md";
const FIXTURE_GOOD_JSON_REL = "scripts/__tests__/fixtures/sentry/good.json";
const FIXTURE_BAD_JSON_REL = "scripts/__tests__/fixtures/sentry/bad.json";
const FIXTURE_NO_URL_JSON_REL = "scripts/__tests__/fixtures/sentry/no-url.json";
const FIXTURE_BAD_SYNTAX_JSON_REL =
  "scripts/__tests__/fixtures/sentry/bad-syntax.json";

function readFixture(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

test("Test 1 (Pass A — runbook cross-link, GREEN): all links in good.md resolve", () => {
  const text = readFixture(FIXTURE_GOOD_RUNBOOK_REL);
  const failures = checkCrossRunbookLinks(FIXTURE_GOOD_RUNBOOK_REL, text, ROOT);
  expect(failures).toEqual([]);
});

test("Test 2 (Pass A — broken runbook cross-link): example.md flags ./does-not-exist.md", () => {
  const text = readFixture(FIXTURE_RUNBOOK_REL);
  const failures = checkCrossRunbookLinks(FIXTURE_RUNBOOK_REL, text, ROOT);
  // At least one failure — the broken link.
  expect(failures.length).toBeGreaterThanOrEqual(1);
  const brokenFailure = failures.find((m) => m.includes("./does-not-exist.md"));
  expect(brokenFailure).toBeDefined();
  expect(brokenFailure).toContain("target not found at");
  expect(brokenFailure).toContain(FIXTURE_RUNBOOK_REL);
  // Failure message includes a 1-based line number (the colon-bracketed form).
  expect(brokenFailure).toMatch(/:\d+:/);
});

test("Test 3 (Pass B — alert JSON missing runbook_url)", () => {
  const text = readFixture(FIXTURE_NO_URL_JSON_REL);
  const failure = checkRunbookUrl(FIXTURE_NO_URL_JSON_REL, text, ROOT);
  expect(failure).not.toBeNull();
  expect(failure).toContain("missing or non-string runbook_url field");
  expect(failure).toContain(FIXTURE_NO_URL_JSON_REL);
});

test("Test 4 (Pass B — alert JSON broken runbook_url)", () => {
  const text = readFixture(FIXTURE_BAD_JSON_REL);
  const failure = checkRunbookUrl(FIXTURE_BAD_JSON_REL, text, ROOT);
  expect(failure).not.toBeNull();
  expect(failure).toContain("runbook_url");
  expect(failure).toContain("target not found at");
  expect(failure).toContain("../runbooks/missing.md");
});

test("Test 5 (Pass B — alert JSON not parseable, D-15 negative)", () => {
  const text = readFixture(FIXTURE_BAD_SYNTAX_JSON_REL);
  const failure = checkRunbookUrl(FIXTURE_BAD_SYNTAX_JSON_REL, text, ROOT);
  expect(failure).not.toBeNull();
  expect(failure).toContain("not valid JSON");
  expect(failure).toContain(FIXTURE_BAD_SYNTAX_JSON_REL);
});

test("Test 6 (Pass B — alert JSON good)", () => {
  const text = readFixture(FIXTURE_GOOD_JSON_REL);
  const failure = checkRunbookUrl(FIXTURE_GOOD_JSON_REL, text, ROOT);
  expect(failure).toBeNull();
});

test("Test 7 (full corpus passes today): bun scripts/validate-docs.ts exits 0", async () => {
  // No docs/runbooks/ or docs/alerts/sentry/ exist yet; Pass A's prefix gate
  // matches nothing, Pass B's glob returns nothing. The 4th invariant therefore
  // contributes zero failures to the live corpus.
  const proc = Bun.spawn(["bun", "scripts/validate-docs.ts"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test("Pass A helper does NOT scan files outside docs/runbooks/ prefix", () => {
  // The fixtures directory IS NOT under docs/runbooks/, but checkCrossRunbookLinks
  // is a pure helper — it inspects the relPath argument's prefix and returns
  // early if not under docs/runbooks/. We exercise the prefix gate here.
  const text = "[broken](./does-not-exist.md)";
  const failures = checkCrossRunbookLinks(
    "docs/integrations/example.md",
    text,
    ROOT,
  );
  expect(failures).toEqual([]);
});
