/**
 * Phase 19 Plan 19-08 Task 2 — D-27 100-RPS concurrent-tenant context-bleed gate.
 * Success Criterion 5 of Phase 19: the gate we cited at phase-boundary as
 * "we did Phase 19 right". Tests at N=100 concurrency — Pitfall 1 (ALS context
 * bleed) surfaces reliably at N≥20 with Promise.all on Elysia's fetch path,
 * so N=100 is well above the detection threshold.
 *
 * Shape:
 *   - Build a minimal Elysia app with a `/probe` endpoint that:
 *       (a) reads `x-test-tenant` from request headers (simulates post-auth
 *           tenant resolution — real tenantMiddleware wiring is unit-tested
 *           elsewhere; this test focuses on the ALS bleed invariant),
 *       (b) publishes it via setTenantContext,
 *       (c) emits a pino log line via a capture stream so we can inspect the
 *           mixin's per-call output,
 *       (d) returns `{ tenantId, requestId }` from the current ALS store.
 *   - Seed ALS outside the handler via obsContext.run(seed, () => app.handle(req))
 *     — mirrors what the Bun.serve fetch wrapper does in apps/api/src/index.ts.
 *   - Fire N=100 interleaved tenantA/tenantB requests via Promise.all.
 *   - Assert:
 *       (1) every response body's `tenantId` matches the request's seeded tenant,
 *       (2) every captured log line's `tenantId` matches the request's seeded
 *           tenant (matched by requestId),
 *       (3) total duration < 30s (CI sanity — the test itself is fast, this
 *           bounds flake/hang scenarios).
 *
 * Test-file self-flag discipline note: this file does NOT contain the
 * banned-method literal token. No dynamic-token construction needed here
 * (grep gate scoped check in scripts/__tests__/enterwith-ban.test.ts covers
 * this file as part of the repo-wide sweep).
 */

import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import pino from "pino";
import {
  getObsContext,
  obsContext,
  setTenantContext,
} from "@baseworks/observability";

type Captured = Record<string, unknown>;

const N = 100;

function buildProbeApp(captured: Captured[]): Elysia {
  const stream = {
    write: (chunk: string) => {
      captured.push(JSON.parse(chunk));
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: pino destination type.
  const testLogger = pino(
    { level: "info", mixin: () => obsContext.getStore() ?? {} },
    stream as any,
  );

  return new Elysia().get("/probe", ({ request }) => {
    const tenantHeader = request.headers.get("x-test-tenant") ?? "NONE";
    // Publish into ALS (simulates tenantMiddleware's post-session mutation).
    setTenantContext({ tenantId: tenantHeader, userId: `U-${tenantHeader}` });
    // Emit a log line — must carry tenantId via the mixin.
    testLogger.info({ at: "probe" }, "probe handler");
    const store = getObsContext();
    return {
      tenantId: store?.tenantId ?? null,
      requestId: store?.requestId ?? null,
    };
  });
}

async function handle(
  app: Elysia,
  tenant: string,
): Promise<{ body: { tenantId: string; requestId: string }; requestId: string }> {
  const requestId = `r-${tenant}-${Math.random().toString(36).slice(2, 10)}`;
  // URL host must be "localhost" — Elysia 1.4's router on Bun treats bare-token
  // hosts as non-matching and returns 404; "http://localhost/..." resolves
  // through the registered routes. Matches the pattern used in Plan 06's
  // bun-serve-als-seed.test.ts and http-span-lifecycle.test.ts.
  const req = new Request("http://localhost/probe", {
    headers: {
      "x-test-tenant": tenant,
      "x-request-id": requestId,
    },
  });
  const seed = {
    requestId,
    traceId: "t".repeat(32),
    spanId: "s".repeat(16),
    locale: "en" as const,
    tenantId: null,
    userId: null,
  };
  const res = await obsContext.run(seed, () => app.handle(req));
  const body = (await res.json()) as {
    tenantId: string;
    requestId: string;
  };
  return { body, requestId };
}

describe("CTX-01 / Success Criterion 5 — 100-RPS concurrent-tenant context bleed gate (D-27)", () => {
  test(
    "100 concurrent interleaved tenantA/tenantB requests — every response + log line carries correct tenantId",
    async () => {
      const captured: Captured[] = [];
      const app = buildProbeApp(captured);
      const jobs = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? "A" : "B"));
      const results = await Promise.all(jobs.map((t) => handle(app, t)));

      // (1) Every response body reflects its own tenant.
      for (let i = 0; i < N; i++) {
        expect(results[i].body.tenantId).toBe(jobs[i]);
        expect(results[i].body.requestId).toBe(results[i].requestId);
      }

      // (2) Every captured log line reflects its own tenant (matched by requestId).
      const requestIdToTenant = new Map(
        results.map((r, i) => [r.requestId, jobs[i]]),
      );
      const probeLines = captured.filter((l) => l.at === "probe");
      expect(probeLines.length).toBe(N);
      for (const line of probeLines) {
        const rid = line.requestId as string;
        const expectedTenant = requestIdToTenant.get(rid);
        expect(line.tenantId).toBe(expectedTenant as string);
      }
    },
    30_000,
  );

  test(
    "100 sequential interleaved requests — same tenant invariant holds",
    async () => {
      const captured: Captured[] = [];
      const app = buildProbeApp(captured);
      const jobs = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? "A" : "B"));
      const results: Array<{
        body: { tenantId: string; requestId: string };
        requestId: string;
      }> = [];
      for (const t of jobs) {
        results.push(await handle(app, t));
      }
      for (let i = 0; i < N; i++) {
        expect(results[i].body.tenantId).toBe(jobs[i]);
      }
      // Log lines also consistent.
      const probeLines = captured.filter((l) => l.at === "probe");
      expect(probeLines.length).toBe(N);
    },
    30_000,
  );

  test(
    "completion time — 100 concurrent requests finish well under 30 seconds",
    async () => {
      const captured: Captured[] = [];
      const app = buildProbeApp(captured);
      const start = performance.now();
      await Promise.all(
        Array.from({ length: N }, (_, i) => handle(app, i % 2 === 0 ? "A" : "B")),
      );
      const dur = performance.now() - start;
      expect(dur).toBeLessThan(30_000);
    },
    30_000,
  );
});
