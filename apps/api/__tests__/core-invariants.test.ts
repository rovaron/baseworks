/**
 * Phase 19 Plan 19-08 Task 2 — TRC-02 core-file byte-equal invariant.
 *
 * The Phase 17/18/19 external-wrap discipline (wrapCqrsBus + wrapEventBus) is
 * predicated on `apps/api/src/core/cqrs.ts` and `apps/api/src/core/event-bus.ts`
 * NEVER being edited during the Phase-19 work. If any Phase 19 commit sneaked
 * a byte-level change into either file, the external-wrap contract has been
 * silently broken — trace semantics become split-brain between "what the
 * wrapper sees" and "what the core does," and a future contributor cannot
 * safely rely on the wrap-only mental model.
 *
 * Baselines captured at Plan 19-08 execution time via:
 *   bun -e "createHash('sha256').update(readFileSync('<path>')).digest('hex')"
 *
 * If a FUTURE phase legitimately edits these files, update the hashes here AND
 * justify in the commit message + phase SUMMARY. Silent edits fail the gate.
 *
 * AUDIT UPDATE: `event-bus.ts` was DELIBERATELY edited (and re-baselined below)
 * to fix `eventbus-off-cannot-unsubscribe` — on()/off() now track wrappers so a
 * caller can actually unsubscribe. This was an approved, justified unfreeze. The
 * gate is kept (re-baselined) to still catch future ACCIDENTAL edits. `cqrs.ts`
 * remains truly wrap-only frozen — its duplicate-key guard lives in registry.ts.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// import.meta.dir == "<repo>/apps/api/__tests__" → up three levels = repo root.
const ROOT = join(import.meta.dir, "../../..");

function hashFile(relPath: string): string {
  const buf = readFileSync(join(ROOT, relPath));
  return createHash("sha256").update(buf).digest("hex");
}

// Baselines re-captured after the repo-wide LF line-ending normalization (audit
// Phase 1: added .gitattributes `eol=lf` + `git add --renormalize`). The
// Phase-19 hashes were computed against CRLF working-tree files on Windows; the
// file CONTENTS are byte-identical apart from line endings, so the wrap-only
// invariant still holds — only the canonical EOL changed.
const CQRS_SHA256 = "20e882f65e7e6948a4fe0cd026c8f0efe6423476b463e27185429312a16ffa4a";
// Re-baselined after the approved unfreeze (off() unsubscribe fix).
const EVENT_BUS_SHA256 = "88126f46d2ca7cb2c292856e653a645269e9542349ad4126bde12ff1bc3a4c27";

describe("TRC-02 — core/cqrs.ts + core/event-bus.ts byte-equal invariant (Plan 19-08)", () => {
  test("apps/api/src/core/cqrs.ts unchanged vs Phase-19 baseline", () => {
    const actual = hashFile("apps/api/src/core/cqrs.ts");
    expect(actual).toBe(CQRS_SHA256);
  });

  test("apps/api/src/core/event-bus.ts unchanged vs Phase-19 baseline", () => {
    const actual = hashFile("apps/api/src/core/event-bus.ts");
    expect(actual).toBe(EVENT_BUS_SHA256);
  });
});
