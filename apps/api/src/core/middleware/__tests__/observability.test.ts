import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import { Elysia } from "elysia";

// Set t3-env-required vars before the @baseworks/observability barrel loads
// (which transitively imports @baseworks/config via scrub-pii.ts). Bun hoists
// `import` statements, so these assignments must happen via a side-effect
// import BEFORE the barrel import runs. Without them, t3-env throws at
// module init. See 19-01 deferred-items.md for context.
import "./_env-setup";

import {
  obsContext,
  resetTracer,
  setTracer,
  type ObservabilityContext,
  type Span,
  type SpanOptions,
  type Tracer,
} from "@baseworks/observability";
import { observabilityMiddleware } from "../observability";

/**
 * Phase 19 observabilityMiddleware — HTTP span lifecycle + D-23 header writer
 * + B4 defensive-read invariant (fail-closed when mounted outside obsContext).
 *
 * Test harness mirrors the recording-tracer pattern from
 * packages/observability/src/wrappers/__tests__/wrap-cqrs-bus.test.ts and
 * drives the middleware through `app.handle(new Request(...))` wrapped in
 * `obsContext.run(seedCtx, ...)` to simulate the Plan 06 Bun.serve seed path.
 */

interface RecordedSpan {
  name: string;
  options?: SpanOptions;
  events: Array<{
    type: "setAttribute" | "setStatus" | "recordException" | "end";
    payload: unknown;
  }>;
}

function makeRecordingTracer(): {
  tracer: Tracer;
  spans: RecordedSpan[];
} {
  const spans: RecordedSpan[] = [];
  const mkSpan = (rec: RecordedSpan): Span => ({
    end: () => rec.events.push({ type: "end", payload: null }),
    setAttribute: (k, v) =>
      rec.events.push({ type: "setAttribute", payload: { k, v } }),
    setStatus: (s) => rec.events.push({ type: "setStatus", payload: s }),
    recordException: (err) =>
      rec.events.push({ type: "recordException", payload: err }),
  });
  const tracer: Tracer = {
    name: "recording",
    startSpan(name, options) {
      const rec: RecordedSpan = { name, options, events: [] };
      spans.push(rec);
      return mkSpan(rec);
    },
    withSpan: async (name, fn, options) => {
      const rec: RecordedSpan = { name, options, events: [] };
      spans.push(rec);
      return await fn(mkSpan(rec));
    },
    inject: () => {},
    extract: () => {},
    currentCarrier: () => ({}),
  };
  return { tracer, spans };
}

function makeCtx(
  overrides: Partial<ObservabilityContext> = {},
): ObservabilityContext {
  return {
    requestId: "r-test",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    locale: "en",
    tenantId: null,
    userId: null,
    ...overrides,
  };
}

async function callApp(
  app: Elysia,
  req: Request,
  seedCtx: ObservabilityContext,
): Promise<Response> {
  return obsContext.run(seedCtx, () => app.handle(req));
}

// Small helper to let deferred `.onAfterResponse` hooks complete before
// assertions run. Elysia fires this hook in a micro-task after the Response
// is returned from `app.handle`.
async function flushAfterResponse(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

describe("observabilityMiddleware — HTTP span lifecycle (D-21)", () => {
  let spans: RecordedSpan[];

  beforeEach(() => {
    const rec = makeRecordingTracer();
    spans = rec.spans;
    setTracer(rec.tracer);
  });

  afterEach(() => {
    resetTracer();
  });

  test("Test 1: opens exactly one server-kind span, name starts with 'GET', carries request.id", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/test-a", () => "ok");
    await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx({ requestId: "REQ-1" }),
    );
    await flushAfterResponse();
    expect(spans.length).toBe(1);
    expect(spans[0].name).toMatch(/^GET/);
    expect(spans[0].options?.kind).toBe("server");
    const reqIdAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "request.id",
    );
    // request.id may be set in startSpan options or as an attribute — both acceptable.
    const startAttrs = (spans[0].options?.attributes ?? {}) as Record<
      string,
      unknown
    >;
    expect(reqIdAttr || startAttrs["request.id"] === "REQ-1").toBeTruthy();
  });

  test("Test 2: setSpan publishes traceId/spanId into ALS (seen in .onBeforeHandle)", async () => {
    let seenTraceIdInBeforeHandle: string | undefined;
    const probeApp = new Elysia({ name: "als-probe" }).onBeforeHandle(
      { as: "global" },
      () => {
        seenTraceIdInBeforeHandle = obsContext.getStore()?.traceId;
      },
    );
    const app = new Elysia()
      .use(observabilityMiddleware)
      .use(probeApp)
      .get("/test-a", () => "ok");
    const seededTrace = "c".repeat(32);
    await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx({ traceId: seededTrace }),
    );
    await flushAfterResponse();
    // setSpan should have mutated the ALS traceId — the probe sees the
    // seeded value (setSpan rewrites in place with the same traceId).
    expect(seenTraceIdInBeforeHandle).toBe(seededTrace);
  });

  test("Test 3 (A1/A8 gate): http.route attribute is the TEMPLATE, not the matched path", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/api/tenants/:id", ({ params }: { params: { id: string } }) => ({
        id: params.id,
      }));
    await callApp(
      app,
      new Request("http://localhost/api/tenants/abc-123"),
      makeCtx(),
    );
    await flushAfterResponse();
    const routeAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "http.route",
    );
    expect(routeAttr).toBeTruthy();
    expect((routeAttr!.payload as { v: unknown }).v).toBe(
      "/api/tenants/:id",
    );
  });

  test("Test 4: http.method attribute matches request method", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .post("/test-p", () => "ok");
    await callApp(
      app,
      new Request("http://localhost/test-p", { method: "POST" }),
      makeCtx(),
    );
    await flushAfterResponse();
    const methodAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "http.method",
    );
    expect(methodAttr).toBeTruthy();
    expect((methodAttr!.payload as { v: unknown }).v).toBe("POST");
  });

  test("Test 5: onError records exception + sets error status; span still ends", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/boom", () => {
        throw new Error("explode");
      });
    await callApp(
      app,
      new Request("http://localhost/boom"),
      makeCtx(),
    );
    await flushAfterResponse();
    const recordExc = spans[0].events.find(
      (e) => e.type === "recordException",
    );
    const setErr = spans[0].events.find(
      (e) =>
        e.type === "setStatus" &&
        (e.payload as { code: string }).code === "error",
    );
    const ended = spans[0].events.find((e) => e.type === "end");
    expect(recordExc).toBeTruthy();
    expect(setErr).toBeTruthy();
    expect(ended).toBeTruthy();
  });

  test("Test 6: onAfterResponse sets http.status_code attribute", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/ok", () => "ok")
      .get("/notfound-custom", ({ set }: { set: { status: number } }) => {
        set.status = 404;
        return "nope";
      });
    await callApp(app, new Request("http://localhost/ok"), makeCtx());
    await flushAfterResponse();
    const statusAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "http.status_code",
    );
    expect(statusAttr).toBeTruthy();
    expect((statusAttr!.payload as { v: unknown }).v).toBe(200);
  });

  test("Test 7: onAfterResponse sets tenant.id + user.id from ALS", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/test-a", () => "ok");
    await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx({ tenantId: "T1", userId: "U1" }),
    );
    await flushAfterResponse();
    const tenantAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "tenant.id",
    );
    const userAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "user.id",
    );
    expect((tenantAttr!.payload as { v: unknown }).v).toBe("T1");
    expect((userAttr!.payload as { v: unknown }).v).toBe("U1");
  });

  test("Test 8: tenant.id attribute OMITTED when ALS tenantId is null (pre-auth routes)", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/test-a", () => "ok");
    await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx({ tenantId: null, userId: null }),
    );
    await flushAfterResponse();
    const tenantAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "tenant.id",
    );
    const userAttr = spans[0].events.find(
      (e) =>
        e.type === "setAttribute" &&
        (e.payload as { k: string }).k === "user.id",
    );
    expect(tenantAttr).toBeUndefined();
    expect(userAttr).toBeUndefined();
  });

  test("Test 9: outbound traceparent header on Response (D-09)", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/test-a", () => "ok");
    const tid = "d".repeat(32);
    const sid = "e".repeat(16);
    const res = await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx({ traceId: tid, spanId: sid }),
    );
    expect(res.headers.get("traceparent")).toBe(`00-${tid}-${sid}-01`);
  });

  test("Test 10: x-request-id header on Response (D-23 single-writer)", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/test-a", () => "ok");
    const res = await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx({ requestId: "RID-10" }),
    );
    expect(res.headers.get("x-request-id")).toBe("RID-10");
  });

  test("Test 11: span.end called exactly once per request", async () => {
    const app = new Elysia()
      .use(observabilityMiddleware)
      .get("/test-a", () => "ok");
    await callApp(
      app,
      new Request("http://localhost/test-a"),
      makeCtx(),
    );
    await flushAfterResponse();
    const endEvents = spans[0].events.filter((e) => e.type === "end");
    expect(endEvents.length).toBe(1);
  });
});

describe("observabilityMiddleware — B4 defensive-read invariant", () => {
  let spans: RecordedSpan[];

  beforeEach(() => {
    const rec = makeRecordingTracer();
    spans = rec.spans;
    setTracer(rec.tracer);
  });

  afterEach(() => {
    resetTracer();
  });

  test("Test 12: mounted outside obsContext.run — no throw, zero spans, no response headers, warning logged", async () => {
    // Stub the logger used by observability.ts BEFORE import so we can
    // capture the warning emitted on the unseeded path. Use cache-bust
    // dynamic-import so the stub is seen at the SUT's module-load.
    const captured: Array<{
      level: number;
      msg?: string;
      middleware?: string;
    }> = [];
    mock.module("../../../lib/logger", () => {
      const fake = {
        warn: (obj: Record<string, unknown>, msg?: string) => {
          captured.push({
            level: 40,
            msg,
            middleware: obj?.middleware as string | undefined,
          });
        },
        info: () => {},
        error: () => {},
        debug: () => {},
        child: () => fake,
      };
      return {
        logger: fake,
        createRequestLogger: () => fake,
      };
    });
    const { observabilityMiddleware: freshMiddleware } = await import(
      `../observability?t=${Date.now()}${Math.random()}`
    );

    const app = new Elysia()
      .use(freshMiddleware)
      .get("/test-a", () => "ok");

    // NOT wrapped in obsContext.run — ALS frame is absent.
    const res = await app.handle(new Request("http://localhost/test-a"));
    await flushAfterResponse();

    // (a) call returns a 200 — no throw.
    expect(res.status).toBe(200);
    // (b) zero spans opened — fail-closed.
    expect(spans.length).toBe(0);
    // (c) warning logged once on derive.
    const warnLine = captured.find((l) =>
      String(l.msg ?? "").includes(
        "observabilityMiddleware invoked without obsContext",
      ),
    );
    expect(warnLine).toBeTruthy();
    // (d) no outbound headers written (no seeded ids to write).
    expect(res.headers.get("x-request-id")).toBeNull();
    expect(res.headers.get("traceparent")).toBeNull();
  });

  test("Test 13: source has zero non-null assertions on ALS reads (byte-level grep)", async () => {
    const src = await Bun.file(
      "apps/api/src/core/middleware/observability.ts",
    ).text();
    // No `store!.` or `getObsContext()!` anywhere in the file.
    expect(src).not.toMatch(/store!\./);
    expect(src).not.toMatch(/getObsContext\(\)!/);
    // At least one defensive early-return pattern present.
    expect(src).toMatch(/if\s*\(\s*!\s*store\s*\)|if\s*\(\s*!\s*_obsSpan\s*\)/);
  });
});
