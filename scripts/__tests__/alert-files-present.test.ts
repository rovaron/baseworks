/**
 * scripts/__tests__/alert-files-present.test.ts (Phase 23 / Plan 23-01 / Task 3)
 *
 * DOC-04 9-alert coverage gate. Asserts that every slug in `_slugs.ts`
 * has a corresponding `docs/alerts/sentry/<slug>.json` file that:
 *   - exists,
 *   - parses as JSON,
 *   - exposes a `runbook_url` string field,
 *   - and that `runbook_url` is exactly `../../runbooks/<slug>.md` (D-14
 *     — the alert and the runbook share a slug 1:1, the relative URL is
 *     two levels up + into runbooks/).
 *
 * Plus: `docs/alerts/sentry/README.md` MUST exist (operator-facing import doc).
 *
 * Wave-0 RED state: 9 alert-file tests + 1 README test fail today because
 * docs/alerts/sentry/ does not exist yet. The tests go GREEN as Plan 23-04 lands.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALERT_SLUGS } from "./_slugs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

for (const slug of ALERT_SLUGS) {
  test(`Sentry alert docs/alerts/sentry/${slug}.json exists and is valid JSON with runbook_url`, () => {
    const path = join(ROOT, "docs/alerts/sentry", `${slug}.json`);
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8");
    const parsed = JSON.parse(text);
    expect(typeof parsed.runbook_url).toBe("string");
    // runbook_url is repo-relative-from-the-JSON-file → "../../runbooks/<slug>.md"
    expect(parsed.runbook_url).toBe(`../../runbooks/${slug}.md`);
  });
}

test("docs/alerts/sentry/README.md exists", () => {
  expect(existsSync(join(ROOT, "docs/alerts/sentry/README.md"))).toBe(true);
});
