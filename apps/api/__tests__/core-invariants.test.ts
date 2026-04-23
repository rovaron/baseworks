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

// Phase-19 baselines — captured at Plan 19-08 task execution time.
const CQRS_SHA256 =
  "89a47de8ad2894d615a4b98de7dd9e84262cf1f68a827d2650f811a68bf1e449";
const EVENT_BUS_SHA256 =
  "19dfe7b51653dcfd3f1fa2b1c4df2527fcb56ec310a3adb3357ba9d616456604";

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
