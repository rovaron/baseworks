/**
 * Bun.serve fetch wrapper + ALS seed integration tests (Phase 19 Plan 06 — Task 1).
 *
 * Covers D-01 (single seed per request), D-07 (default untrusted trace), D-12
 * (NEXT_LOCALE cookie parse), D-16 (wrapEventBus call site), and D-22 (middleware
 * order + localeMiddleware deletion).
 *
 * Tests 1-7 exercise the in-process equivalent of the Bun.serve fetch wrapper
 * via a `handleReq(req, remoteAddr, app)` helper that uses the SAME Plan 05
 * helpers (`parseNextLocaleCookie`, `decideInboundTrace`, `obsContext.run`) as
 * the production wrapper in apps/api/src/index.ts.
 *
 * Tests 8-10 are byte-level source-file invariants (grep over the actual
 * `apps/api/src/index.ts` contents).
 *
 * Env-setup side-effect import loads BEFORE the `@baseworks/observability`
 * barrel (which transitively imports `@baseworks/config` + t3-env) to satisfy
 * env validation in the test sandbox. Pattern from 19-05-SUMMARY.md.
 */
import { describe, test, expect } from "bun:test";

import "../src/core/middleware/__tests__/_env-setup";

import { Elysia } from "elysia";
import {
  obsContext,
  getObsContext,
  setTenantContext,
  type ObservabilityContext,
} from "@baseworks/observability";
import { defaultLocale } from "@baseworks/i18n";
import { parseNextLocaleCookie } from "../src/lib/locale-cookie";
import { decideInboundTrace } from "../src/lib/inbound-trace";

/**
 * In-process equivalent of the canonical Bun.serve fetch wrapper in
 * apps/api/src/index.ts. Re-declared here so tests are boot-free.
 */
async function handleReq(
  req: Request,
  remoteAddr: string,
  app: Elysia,
): Promise<Response> {
  const cookieHeader = req.headers.get("cookie");
  const locale = parseNextLocaleCookie(cookieHeader) ?? defaultLocale;
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { traceId, spanId, inboundCarrier } = decideInboundTrace(
    req,
    remoteAddr,
  );
  const seed: ObservabilityContext = {
    requestId,
    traceId,
    spanId,
    locale,
    tenantId: null,
    userId: null,
    inboundCarrier,
  };
  return obsContext.run(seed, () => app.handle(req));
}

function buildProbeApp(): Elysia {
  return new Elysia().get("/snapshot", () => {
    // Return a JSON snapshot of the ALS store so tests can assert on it.
    const ctx = getObsContext();
    return {
      requestId: ctx?.requestId ?? null,
      traceId: ctx?.traceId ?? null,
      spanId: ctx?.spanId ?? null,
      locale: ctx?.locale ?? null,
      tenantId: ctx?.tenantId ?? null,
      userId: ctx?.userId ?? null,
      inboundTraceparent: ctx?.inboundCarrier?.traceparent ?? null,
    };
  });
}

describe("Bun.serve fetch wrapper + ALS seed (Plan 06 Task 1)", () => {
  test("Test 1 (D-01): seeded requestId is visible inside the route handler", async () => {
    const app = buildProbeApp();
    const req = new Request("http://localhost/snapshot", {
      headers: { "x-request-id": "seed-1" },
    });
    const res = await handleReq(req, "10.1.1.1", app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requestId: string | null };
    expect(body.requestId).toBe("seed-1");
  });

  test("Test 2 (D-01): sequential requests do NOT share ALS frames", async () => {
    const app = buildProbeApp();
    const res1 = await handleReq(
      new Request("http://localhost/snapshot", {
        headers: { "x-request-id": "rA" },
      }),
      "10.1.1.1",
      app,
    );
    const body1 = (await res1.json()) as { requestId: string };
    const res2 = await handleReq(
      new Request("http://localhost/snapshot", {
        headers: { "x-request-id": "rB" },
      }),
      "10.1.1.1",
      app,
    );
    const body2 = (await res2.json()) as { requestId: string };
    expect(body1.requestId).toBe("rA");
    expect(body2.requestId).toBe("rB");
    expect(body1.requestId).not.toBe(body2.requestId);
  });

  test("Test 3 (D-01): 10 concurrent requests each see their own ALS seed", async () => {
    const app = buildProbeApp();
    const N = 10;
    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        handleReq(
          new Request("http://localhost/snapshot", {
            headers: { "x-request-id": `rc-${i}` },
          }),
          "10.1.1.1",
          app,
        ),
      ),
    );
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{
      requestId: string;
    }>;
    for (let i = 0; i < N; i++) {
      expect(bodies[i].requestId).toBe(`rc-${i}`);
    }
    // Uniqueness check
    const ids = new Set(bodies.map((b) => b.requestId));
    expect(ids.size).toBe(N);
  });

  test("Test 4 (D-12): NEXT_LOCALE=pt-BR cookie → ALS locale = 'pt-BR'", async () => {
    const app = buildProbeApp();
    const res = await handleReq(
      new Request("http://localhost/snapshot", {
        headers: { cookie: "NEXT_LOCALE=pt-BR" },
      }),
      "10.1.1.1",
      app,
    );
    const body = (await res.json()) as { locale: string };
    expect(body.locale).toBe("pt-BR");
  });

  test("Test 5 (D-12): absent cookie → ALS locale = defaultLocale", async () => {
    const app = buildProbeApp();
    const res = await handleReq(
      new Request("http://localhost/snapshot"),
      "10.1.1.1",
      app,
    );
    const body = (await res.json()) as { locale: string };
    expect(body.locale).toBe(defaultLocale);
  });

  test("Test 6 (D-07): untrusted inbound traceparent → fresh server-side trace; carrier preserves inbound", async () => {
    const app = buildProbeApp();
    const inboundTp =
      "00-aabbccddeeff00112233445566778899-1122334455667788-01";
    const res = await handleReq(
      new Request("http://localhost/snapshot", {
        headers: { traceparent: inboundTp },
      }),
      "10.1.1.1",
      app,
    );
    const body = (await res.json()) as {
      traceId: string;
      inboundTraceparent: string | null;
    };
    // Fresh server-side trace (32 hex) that does NOT equal the inbound traceId
    expect(body.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(body.traceId).not.toBe("aabbccddeeff00112233445566778899");
    // Inbound carrier preserves the original traceparent for Phase 21 OTEL Link
    expect(body.inboundTraceparent).toBe(inboundTp);
  });

  test("Test 7: x-request-id header is honored as ALS seed source", async () => {
    const app = buildProbeApp();
    const res = await handleReq(
      new Request("http://localhost/snapshot", {
        headers: { "x-request-id": "upstream-id" },
      }),
      "10.1.1.1",
      app,
    );
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe("upstream-id");
  });

  test("Test 8 (D-16): wrapEventBus call site present in apps/api/src/index.ts", async () => {
    const src = await Bun.file("apps/api/src/index.ts").text();
    const callSiteMatches = src.match(
      /wrapEventBus\(\s*registry\.getEventBus\(\),\s*getTracer\(\)\s*\)/g,
    );
    expect(callSiteMatches).not.toBeNull();
    expect(callSiteMatches!.length).toBe(1);
  });

  test("Test 9 (D-22): localeMiddleware fully removed from apps/api/src/index.ts", async () => {
    const src = await Bun.file("apps/api/src/index.ts").text();
    const matches = src.match(/localeMiddleware/g);
    // Zero references — neither import nor .use(...)
    expect(matches).toBeNull();
  });

  test("Test 10 (D-22): middleware order — errorMiddleware before observabilityMiddleware before requestTraceMiddleware", async () => {
    const src = await Bun.file("apps/api/src/index.ts").text();
    // Find the .use() call sites (not imports) in source-order.
    const useMatches = [
      ...src.matchAll(
        /\.use\(\s*(errorMiddleware|observabilityMiddleware|requestTraceMiddleware)\b/g,
      ),
    ];
    expect(useMatches.length).toBeGreaterThanOrEqual(3);
    const order = useMatches.slice(0, 3).map((m) => m[1]);
    expect(order).toEqual([
      "errorMiddleware",
      "observabilityMiddleware",
      "requestTraceMiddleware",
    ]);
  });

  // Bonus coverage: Test 1 sanity — tenantId is null at seed time; setTenantContext
  // mutates store in place (Plan 01 / D-04 contract exercised at integration scope).
  test("Bonus: setTenantContext mutates the seeded ALS store in place", async () => {
    const app = new Elysia().get("/probe", () => {
      setTenantContext({ tenantId: "T-x", userId: "U-x" });
      const ctx = getObsContext();
      return { tenantId: ctx?.tenantId ?? null, userId: ctx?.userId ?? null };
    });
    const res = await handleReq(
      new Request("http://localhost/probe"),
      "10.1.1.1",
      app,
    );
    const body = (await res.json()) as {
      tenantId: string | null;
      userId: string | null;
    };
    expect(body.tenantId).toBe("T-x");
    expect(body.userId).toBe("U-x");
  });
});
