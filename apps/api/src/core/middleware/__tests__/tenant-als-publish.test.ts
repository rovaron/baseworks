/**
 * tenant.ts + request-trace.ts ALS integration tests (Phase 19 Plan 06 — Task 2).
 *
 * Covers:
 *   - D-23 request-trace.ts: requestId sourced from ALS getObsContext()?.requestId;
 *     x-request-id header writer DELETED (observabilityMiddleware is single writer).
 *   - D-04 tenant.ts: setTenantContext({ tenantId, userId }) called after session
 *     resolution; ALS tenantId/userId enriched post-derive.
 *
 * Tests 1–3: request-trace.ts behavior + byte-level source invariants.
 * Tests 4–6: tenantMiddleware ALS publish + safe-on-failure guarantees.
 */
import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";

// Set t3-env-required vars BEFORE the @baseworks/observability barrel loads.
// Bun hoists imports; side-effect module runs first.
import "./_env-setup";

import { Elysia } from "elysia";
import {
  obsContext,
  getObsContext,
  type ObservabilityContext,
} from "@baseworks/observability";

/**
 * Build a canonical ObservabilityContext seed for tests.
 */
function seed(
  overrides: Partial<ObservabilityContext> = {},
): ObservabilityContext {
  return {
    requestId: "als-id",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    locale: "en",
    tenantId: null,
    userId: null,
    ...overrides,
  };
}

describe("request-trace.ts — D-23 (requestId from ALS; no x-request-id writer)", () => {
  test("Test 1: derive pulls requestId from ALS", async () => {
    const { requestTraceMiddleware } = await import(
      `../request-trace?t=${Date.now()}`
    );
    let seenRequestId: string | undefined;
    const app = new Elysia().use(requestTraceMiddleware).get(
      "/probe",
      (ctx: { requestId: string }) => {
        seenRequestId = ctx.requestId;
        return "ok";
      },
    );
    await obsContext.run(seed({ requestId: "als-id" }), () =>
      app.handle(new Request("http://localhost/probe")),
    );
    expect(seenRequestId).toBe("als-id");
  });

  test("Test 2: fallback to 'unknown' when called outside an ALS frame", async () => {
    const { requestTraceMiddleware } = await import(
      `../request-trace?t=${Date.now()}-b`
    );
    let seenRequestId: string | undefined;
    const app = new Elysia().use(requestTraceMiddleware).get(
      "/probe",
      (ctx: { requestId: string }) => {
        seenRequestId = ctx.requestId;
        return "ok";
      },
    );
    // NO obsContext.run wrapper — simulate running outside a seeded frame.
    await app.handle(new Request("http://localhost/probe"));
    expect(seenRequestId).toBe("unknown");
  });

  test("Test 3 (byte-level): request-trace.ts no longer writes x-request-id", async () => {
    const src = await Bun.file(
      "apps/api/src/core/middleware/request-trace.ts",
    ).text();
    // No x-request-id string literal anywhere in the source.
    expect(src.toLowerCase().includes("x-request-id")).toBe(false);
    // No set.headers writer.
    expect(/set\.headers\s*=|\bset\.headers\s*\[/.test(src)).toBe(false);
    // getObsContext is imported and used exactly twice (import + usage).
    const matches = src.match(/getObsContext/g);
    expect(matches?.length).toBe(2);
  });
});

describe("tenant.ts — D-04 (setTenantContext ALS publish after session resolution)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("Test 4: publishes tenantId + userId into ALS when session resolves", async () => {
    // Mock @baseworks/module-auth to return a fixed session.
    mock.module("@baseworks/module-auth", () => ({
      auth: {
        api: {
          getSession: async () => ({
            session: {
              activeOrganizationId: "T1",
              userId: "U1",
            },
            user: { id: "U1", email: "u1@example.com" },
          }),
          listOrganizations: async () => [],
          setActiveOrganization: async () => {},
        },
      },
    }));
    // Re-import middleware so it picks up the mocked auth module.
    const { tenantMiddleware } = await import(
      `../tenant?t=${Date.now()}-t4`
    );

    let alsAfterDerive: ObservabilityContext | undefined;
    const app = new Elysia().use(tenantMiddleware).get("/probe", () => {
      alsAfterDerive = getObsContext();
      return "ok";
    });

    const res = await obsContext.run(seed(), () =>
      app.handle(new Request("http://localhost/probe")),
    );
    expect(res.status).toBe(200);
    expect(alsAfterDerive?.tenantId).toBe("T1");
    expect(alsAfterDerive?.userId).toBe("U1");
  });

  test("Test 5: ALS untouched when tenant resolution throws 'No active tenant'", async () => {
    mock.module("@baseworks/module-auth", () => ({
      auth: {
        api: {
          getSession: async () => ({
            session: { activeOrganizationId: null, userId: "U2" },
            user: { id: "U2", email: "u2@example.com" },
          }),
          listOrganizations: async () => [], // empty — triggers "No active tenant"
          setActiveOrganization: async () => {},
        },
      },
    }));
    const { tenantMiddleware } = await import(
      `../tenant?t=${Date.now()}-t5`
    );

    const app = new Elysia().use(tenantMiddleware).get("/probe", () => "ok");
    const seeded = seed();
    let alsDuring: ObservabilityContext | undefined;
    // Observe ALS snapshot at response time via the `obsContext.run` callback.
    await obsContext.run(seeded, async () => {
      try {
        await app.handle(new Request("http://localhost/probe"));
      } catch {
        // Expected — but Elysia may swallow + render a 500 via onError.
      }
      alsDuring = getObsContext();
    });
    // setTenantContext MUST NOT have run — ALS retains the seed's nulls.
    expect(alsDuring?.tenantId).toBeNull();
    expect(alsDuring?.userId).toBeNull();
  });

  test("Test 6 (byte-level): tenant.ts imports setTenantContext and calls it once", async () => {
    const src = await Bun.file(
      "apps/api/src/core/middleware/tenant.ts",
    ).text();
    // Exactly one import + one call site.
    const matches = src.match(/setTenantContext/g);
    expect(matches?.length).toBe(2);
    // Import from @baseworks/observability.
    expect(
      /import\s*\{[^}]*setTenantContext[^}]*\}\s*from\s*"@baseworks\/observability"/.test(
        src,
      ),
    ).toBe(true);
    // Call site passes session.user.id.
    expect(
      /setTenantContext\(\s*\{\s*tenantId\s*,\s*userId:\s*session\.user\.id\s*\}\s*\)/.test(
        src,
      ),
    ).toBe(true);
  });
});
