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
 * Test fixture layout: `scripts/__tests__/fixtures/` mirrors the live repo's
 * `docs/runbooks/` and `docs/alerts/sentry/` shape so the helpers' built-in
 * prefix gate (`relPath.startsWith("docs/runbooks/")`) and dirname-based
 * target resolution work unmodified. Tests pass `FIXTURE_ROOT` as the `root`
 * argument and synthetic `docs/runbooks/<file>.md` paths as `relPath`.
 *
 * Test 7 ("full corpus passes today") is implemented as a subprocess invocation
 * because it asserts the complete CLI exit semantics, not just helper return
 * values.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCrossRunbookLinks, checkRunbookUrl } from "../validate-docs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
// FIXTURE_ROOT contains a `docs/runbooks/` and `docs/alerts/sentry/` subtree
// so the validator's prefix gate (`startsWith("docs/runbooks/")`) fires and
// the dirname-based resolution lands on real fixture files.
const FIXTURE_ROOT = join(REPO_ROOT, "scripts/__tests__/fixtures");

const RUNBOOK_REL = "docs/runbooks/example.md";
const GOOD_RUNBOOK_REL = "docs/runbooks/good.md";
const GOOD_JSON_REL = "docs/alerts/sentry/good.json";
const BAD_JSON_REL = "docs/alerts/sentry/bad.json";
const NO_URL_JSON_REL = "docs/alerts/sentry/no-url.json";
const BAD_SYNTAX_JSON_REL = "docs/alerts/sentry/bad-syntax.json";

function readFixture(rel: string): string {
  return readFileSync(join(FIXTURE_ROOT, rel), "utf8");
}

test("Test 1 (Pass A — runbook cross-link, GREEN): all links in good.md resolve", () => {
  const text = readFixture(GOOD_RUNBOOK_REL);
  const failures = checkCrossRunbookLinks(GOOD_RUNBOOK_REL, text, FIXTURE_ROOT);
  expect(failures).toEqual([]);
});

test("Test 2 (Pass A — broken runbook cross-link): example.md flags ./does-not-exist.md", () => {
  const text = readFixture(RUNBOOK_REL);
  const failures = checkCrossRunbookLinks(RUNBOOK_REL, text, FIXTURE_ROOT);
  // At least one failure — the broken link.
  expect(failures.length).toBeGreaterThanOrEqual(1);
  const brokenFailure = failures.find((m) => m.includes("./does-not-exist.md"));
  expect(brokenFailure).toBeDefined();
  expect(brokenFailure).toContain("target not found at");
  expect(brokenFailure).toContain(RUNBOOK_REL);
  // Failure message includes a 1-based line number (the colon-bracketed form).
  expect(brokenFailure).toMatch(/:\d+:/);
});

test("Test 3 (Pass B — alert JSON missing runbook_url)", () => {
  const text = readFixture(NO_URL_JSON_REL);
  const failure = checkRunbookUrl(NO_URL_JSON_REL, text, FIXTURE_ROOT);
  expect(failure).not.toBeNull();
  expect(failure).toContain("missing or non-string runbook_url field");
  expect(failure).toContain(NO_URL_JSON_REL);
});

test("Test 4 (Pass B — alert JSON broken runbook_url)", () => {
  const text = readFixture(BAD_JSON_REL);
  const failure = checkRunbookUrl(BAD_JSON_REL, text, FIXTURE_ROOT);
  expect(failure).not.toBeNull();
  expect(failure).toContain("runbook_url");
  expect(failure).toContain("target not found at");
  expect(failure).toContain("../../runbooks/missing.md");
});

test("Test 5 (Pass B — alert JSON not parseable, D-15 negative)", () => {
  const text = readFixture(BAD_SYNTAX_JSON_REL);
  const failure = checkRunbookUrl(BAD_SYNTAX_JSON_REL, text, FIXTURE_ROOT);
  expect(failure).not.toBeNull();
  expect(failure).toContain("not valid JSON");
  expect(failure).toContain(BAD_SYNTAX_JSON_REL);
});

test("Test 6 (Pass B — alert JSON good)", () => {
  const text = readFixture(GOOD_JSON_REL);
  const failure = checkRunbookUrl(GOOD_JSON_REL, text, FIXTURE_ROOT);
  expect(failure).toBeNull();
});

test("Test 7 (full corpus passes today): bun scripts/validate-docs.ts exits 0", async () => {
  // No docs/runbooks/ or docs/alerts/sentry/ exist yet under the live REPO_ROOT
  // (fixtures live under scripts/__tests__/fixtures/, not docs/). Pass A's
  // prefix gate matches nothing, Pass B's glob over `docs/alerts/sentry/*.json`
  // returns nothing. The 4th invariant therefore contributes zero failures
  // to the live corpus.
  const proc = Bun.spawn(["bun", "scripts/validate-docs.ts"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test("Pass A helper does NOT scan files outside docs/runbooks/ prefix", () => {
  // The helper inspects the relPath argument's prefix and returns early if
  // not under docs/runbooks/. Other docs paths may have broken cross-links —
  // this invariant intentionally does not police them (out-of-scope per D-10).
  const text = "[broken](./does-not-exist.md)";
  const failures = checkCrossRunbookLinks("docs/integrations/example.md", text, FIXTURE_ROOT);
  expect(failures).toEqual([]);
});

test("Pass B helper resolves runbook_url relative to the JSON file's own directory", () => {
  // good.json contains `runbook_url: "../../runbooks/other.md"` —
  // dirname(docs/alerts/sentry/good.json) is `docs/alerts/sentry`, so the
  // resolved target lands on FIXTURE_ROOT/docs/runbooks/other.md.
  const text = readFixture(GOOD_JSON_REL);
  const failure = checkRunbookUrl(GOOD_JSON_REL, text, FIXTURE_ROOT);
  expect(failure).toBeNull();
});
