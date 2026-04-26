import { describe, test, expect } from "bun:test";
import { Glob } from "bun";
import { join, sep } from "node:path";

/**
 * Phase 19 Plan 03 Task 2 — CTX-03 call-site invariance gate.
 *
 * The pino mixin (wired in Plan 03 Task 1) is THE integration path for ALS
 * fields flowing into log lines, traces, and CQRS/HTTP spans. Module handler
 * code, route handler code, and command/query handler code MUST NEVER read
 * obsContext directly — they rely on the mixin merging ALS fields at log
 * serialization time.
 *
 * This test is a grep-based integration gate: any future PR that adds a
 * direct `obsContext.getStore()` or `getObsContext()` call outside the
 * explicit allow-list fails CI. Forces authors either to (a) move the read
 * into the mixin / observability layer, or (b) add their file to the
 * allow-list with a justifying decision record.
 *
 * Implementation uses Bun.Glob + Bun.file (no shell dependency; runs
 * identically on Windows and POSIX) — matches the Phase 18 source-reading
 * invariant test pattern.
 */

// Repo root from apps/api/__tests__/logger-callsite-invariance.test.ts.
// import.meta.dir == "<repo>/apps/api/__tests__" → up three levels = repo root.
const ROOT = join(import.meta.dir, "../../..");

/**
 * The ONLY files permitted to read obsContext directly. Everything else
 * relies on the pino mixin (CTX-03 "no call-site edits" invariant).
 *
 * The list is intentionally generous so this gate stays green as Wave 2's
 * siblings (Plans 04, 05) land and Wave 3 (Plans 06, 07, 08) follows. Each
 * entry below corresponds to a concrete decision record in 19-CONTEXT.md.
 */
const ALLOWED = new Set<string>([
  "apps/api/src/core/middleware/observability.ts", // D-21 — HTTP span + ALS setSpan
  "apps/api/src/core/middleware/request-trace.ts", // D-23 — reads requestId from ALS
  "apps/api/src/lib/logger.ts", // D-19 — pino mixin (this plan)
  "apps/api/src/index.ts", // D-01 — Bun.serve fetch wrapper seeds + reads
  "apps/api/src/worker.ts", // D-05 — worker createWorker seeds
  "apps/api/src/lib/inbound-trace.ts", // D-07/D-08 — trust-policy parser (Plan 05)
  "packages/modules/auth/src/locale-context.ts", // D-11 — getLocale() compat shim
  "packages/observability/src/context.ts", // D-06 — the canonical store + mutators
  "packages/observability/src/wrappers/wrap-cqrs-bus.ts", // D-17 — ALS-derived span attrs
  "packages/observability/src/wrappers/wrap-event-bus.ts", // D-15/D-16 — ALS-derived span attrs
  "packages/observability/src/wrappers/wrap-queue.ts", // Phase 20 D-02 — producer carrier inject from ALS
  "packages/queue/src/index.ts", // D-05 — central createWorker seeds
]);

async function findObsReads(pattern: string): Promise<string[]> {
  const g = new Glob(pattern);
  const matches: string[] = [];
  for await (const path of g.scan({ cwd: ROOT, absolute: false })) {
    // Skip any file under node_modules or any __tests__ directory. Test
    // files are allowed to read obsContext freely; this gate is about
    // PRODUCTION call sites.
    if (path.includes("node_modules")) continue;
    if (path.includes(`${sep}__tests__${sep}`) || path.includes("/__tests__/")) continue;
    // Skip nested worktree shadows (e.g. .claude/worktrees/**) — parallel
    // executor artefacts that are not part of the primary tree.
    if (path.includes(".claude")) continue;
    const text = await Bun.file(join(ROOT, path)).text();
    if (/obsContext\.getStore\(\)|getObsContext\(/.test(text)) {
      // Normalize to forward-slash-delimited POSIX-style paths for
      // portable allow-list comparison.
      matches.push(path.split(sep).join("/"));
    }
  }
  return matches.sort();
}

describe("CTX-03 — pino mixin is the only ALS integration path; handler code never reads obsContext directly", () => {
  test("no handler file in packages/modules/*/src/(handlers|commands|queries) reads obsContext", async () => {
    const patterns = [
      "packages/modules/*/src/handlers/**/*.ts",
      "packages/modules/*/src/commands/**/*.ts",
      "packages/modules/*/src/queries/**/*.ts",
    ];
    for (const p of patterns) {
      const bad = await findObsReads(p);
      expect(bad).toEqual([]);
    }
  });

  test("no route file in apps/api/src/routes reads obsContext", async () => {
    const bad = await findObsReads("apps/api/src/routes/**/*.ts");
    expect(bad).toEqual([]);
  });

  test("any obsContext read in apps/api/src OR packages/ is on the allow-list", async () => {
    const all = [
      ...(await findObsReads("apps/api/src/**/*.ts")),
      ...(await findObsReads("packages/**/*.ts")),
    ];
    const offenders = all.filter((p) => !ALLOWED.has(p));
    expect(offenders).toEqual([]);
  });
});
