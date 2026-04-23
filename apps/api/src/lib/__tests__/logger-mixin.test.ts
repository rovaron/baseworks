import { describe, test, expect, beforeEach } from "bun:test";
import pino, { type Logger } from "pino";
import { obsContext, type ObservabilityContext } from "@baseworks/observability";

/**
 * Phase 19 Plan 03 Task 1 — pino mixin unit test suite (D-19, D-20).
 *
 * Verifies the mixin body `() => obsContext.getStore() ?? {}` wired into the
 * production pino instance at `apps/api/src/lib/logger.ts`:
 *
 *  - Test 1: mixin called per-log-invocation; all ALS fields merged into every
 *    log line emitted inside `obsContext.run(...)` (D-19).
 *  - Test 2: child-logger bindings compose with mixin output (D-19).
 *  - Test 3: in-call bindings override mixin output — `logger.info({ x }, ...)`
 *    wins over the ALS store's `x` (D-19 / in-call priority invariant).
 *  - Test 4: logs emitted OUTSIDE any `obsContext.run(...)` frame do not crash
 *    and contain no ALS field keys (D-20 / startup & shutdown safety).
 *  - Test 5: nullable tenantId / userId propagate as literal `null` (D-02).
 *  - Test 6: deep child-chains compose with mixin — `.child(a).child(b).info()`
 *    includes both bindings AND every ALS field.
 *  - Test 7: closure-purity regression guard (Pitfall 4) — the mixin body is
 *    `() => getStore() ?? {}` with NO extracted fields; frame-A and frame-B
 *    yield different ALS values on the SAME logger instance.
 *  - Test 8: production logger smoke test — importing from "../logger" yields a
 *    real pino instance with `.info`/`.child` methods (wiring compiles).
 *
 * Capture-stream pattern reused from Phase 18 Plan 04 (STATE line 82):
 *   `pino({ level: "debug", mixin }, customStream)` where `customStream.write`
 *   parses each JSON chunk into an array for assertions.
 */

type Captured = Record<string, unknown>;

function captureLogger(): { logger: Logger; captured: Captured[] } {
  const captured: Captured[] = [];
  const stream = {
    write: (chunk: string) => {
      captured.push(JSON.parse(chunk));
    },
  };
  const testLogger = pino(
    { level: "debug", mixin: () => obsContext.getStore() ?? {} },
    // biome-ignore lint/suspicious/noExplicitAny: minimal pino destination shape for tests
    stream as any,
  );
  return { logger: testLogger, captured };
}

const seedCtx: ObservabilityContext = {
  requestId: "r1",
  // 32 hex chars (16 bytes traceId per W3C traceparent)
  traceId: "t1".repeat(16),
  // 16 hex chars (8 bytes spanId)
  spanId: "s1".repeat(8),
  locale: "en",
  tenantId: "T1",
  userId: "U1",
};

describe("logger mixin — D-19 / D-20 (per-call ALS merge)", () => {
  let captured: Captured[];
  let logger: Logger;

  beforeEach(() => {
    const tools = captureLogger();
    logger = tools.logger;
    captured = tools.captured;
  });

  test("Test 1 — mixin fires on every log call inside obsContext.run (D-19)", () => {
    obsContext.run(seedCtx, () => {
      logger.info("one");
      logger.info("two");
      logger.info("three");
    });

    expect(captured).toHaveLength(3);
    for (const chunk of captured) {
      expect(chunk.requestId).toBe("r1");
      expect(chunk.traceId).toBe(seedCtx.traceId);
      expect(chunk.spanId).toBe(seedCtx.spanId);
      expect(chunk.tenantId).toBe("T1");
      expect(chunk.userId).toBe("U1");
      expect(chunk.locale).toBe("en");
    }
  });

  test("Test 2 — child-logger bindings compose with mixin output (D-19)", () => {
    obsContext.run(seedCtx, () => {
      const child = logger.child({ custom: "field" });
      child.info("child-msg");
    });

    expect(captured).toHaveLength(1);
    const chunk = captured[0];
    expect(chunk.custom).toBe("field");
    expect(chunk.requestId).toBe("r1");
    expect(chunk.traceId).toBe(seedCtx.traceId);
    expect(chunk.tenantId).toBe("T1");
    expect(chunk.userId).toBe("U1");
    expect(chunk.locale).toBe("en");
    expect(chunk.msg).toBe("child-msg");
  });

  test("Test 3 — in-call bindings override mixin output (D-19 priority)", () => {
    obsContext.run({ ...seedCtx, requestId: "ALS_R" }, () => {
      logger.info({ requestId: "INLINE_R" }, "override");
    });

    expect(captured).toHaveLength(1);
    const chunk = captured[0];
    // In-call binding wins over mixin output at pino serialization time.
    expect(chunk.requestId).toBe("INLINE_R");
    // Other ALS fields still flow through from the mixin.
    expect(chunk.tenantId).toBe("T1");
    expect(chunk.traceId).toBe(seedCtx.traceId);
  });

  test("Test 4 — logs outside any request frame emit without ALS fields + no crash (D-20)", () => {
    // No obsContext.run frame — mimics startup / shutdown / migration logs.
    expect(() => logger.info("startup")).not.toThrow();

    expect(captured).toHaveLength(1);
    const chunk = captured[0];
    expect(chunk.msg).toBe("startup");
    expect(chunk).not.toHaveProperty("requestId");
    expect(chunk).not.toHaveProperty("traceId");
    expect(chunk).not.toHaveProperty("spanId");
    expect(chunk).not.toHaveProperty("tenantId");
    expect(chunk).not.toHaveProperty("userId");
    expect(chunk).not.toHaveProperty("locale");
  });

  test("Test 5 — nullable tenantId / userId propagate as literal null (D-02)", () => {
    const preAuthCtx: ObservabilityContext = {
      requestId: "r",
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      locale: "en",
      tenantId: null,
      userId: null,
    };

    obsContext.run(preAuthCtx, () => {
      logger.info("pre-auth");
    });

    expect(captured).toHaveLength(1);
    const chunk = captured[0];
    expect(chunk.tenantId).toBeNull();
    expect(chunk.userId).toBeNull();
    // Presence assertions: pino DOES emit null fields (verified for Plan 08
    // bleed test).
    expect(Object.hasOwn(chunk, "tenantId")).toBe(true);
    expect(Object.hasOwn(chunk, "userId")).toBe(true);
  });

  test("Test 6 — deep child-chain composes with mixin (D-19)", () => {
    obsContext.run(seedCtx, () => {
      logger.child({ a: 1 }).child({ b: 2 }).info("deep");
    });

    expect(captured).toHaveLength(1);
    const chunk = captured[0];
    expect(chunk.a).toBe(1);
    expect(chunk.b).toBe(2);
    expect(chunk.requestId).toBe("r1");
    expect(chunk.traceId).toBe(seedCtx.traceId);
    expect(chunk.spanId).toBe(seedCtx.spanId);
    expect(chunk.tenantId).toBe("T1");
    expect(chunk.userId).toBe("U1");
    expect(chunk.locale).toBe("en");
    expect(chunk.msg).toBe("deep");
  });

  test("Test 7 — Pitfall 4 closure-purity: frame-A vs frame-B yield different ALS (regression guard)", () => {
    const ctxA: ObservabilityContext = { ...seedCtx, requestId: "A", tenantId: "tenantA" };
    const ctxB: ObservabilityContext = { ...seedCtx, requestId: "B", tenantId: "tenantB" };

    obsContext.run(ctxA, () => logger.info("a-msg"));
    obsContext.run(ctxB, () => logger.info("b-msg"));

    expect(captured).toHaveLength(2);
    const [chunkA, chunkB] = captured;
    expect(chunkA.requestId).toBe("A");
    expect(chunkA.tenantId).toBe("tenantA");
    expect(chunkA.msg).toBe("a-msg");
    expect(chunkB.requestId).toBe("B");
    expect(chunkB.tenantId).toBe("tenantB");
    expect(chunkB.msg).toBe("b-msg");
    // Hard assertion that the mixin did not cache fields from frame-A.
    expect(chunkA.requestId).not.toBe(chunkB.requestId);
    expect(chunkA.tenantId).not.toBe(chunkB.tenantId);
  });
});

describe("logger.ts production wiring smoke test", () => {
  test("Test 8 — production logger imports cleanly and exposes pino API", async () => {
    const mod = await import("../logger");
    expect(mod.logger).toBeDefined();
    expect(typeof mod.logger.info).toBe("function");
    expect(typeof mod.logger.error).toBe("function");
    expect(typeof mod.logger.debug).toBe("function");
    expect(typeof mod.logger.warn).toBe("function");
    expect(typeof mod.logger.child).toBe("function");
    // Wave 1 preserved createRequestLogger export as well.
    expect(typeof mod.createRequestLogger).toBe("function");
  });

  test("Test 9 — production logger.ts source has the mixin wired (D-19 literal compliance)", async () => {
    // Source-level assertion: the mixin body MUST be the exact verbatim
    // `() => obsContext.getStore() ?? {}` form. No extracted fields, no
    // closure captures (Pitfall 4 regression guard at the SOURCE level).
    const file = Bun.file(
      new URL("../logger.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
    );
    const text = await file.text();
    // The import must be present.
    expect(text).toMatch(/import\s*\{\s*obsContext\s*\}\s*from\s*["']@baseworks\/observability["']/);
    // The mixin option must be present with the verbatim arrow body.
    expect(text).toMatch(/mixin:\s*\(\)\s*=>\s*obsContext\.getStore\(\)\s*\?\?\s*\{\}/);
  });
});
