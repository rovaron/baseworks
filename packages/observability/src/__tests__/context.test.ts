import { describe, test, expect } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { defaultLocale, type Locale } from "@baseworks/i18n";
import {
  obsContext,
  getObsContext,
  setTenantContext,
  setSpan,
  setLocale,
  type ObservabilityContext,
} from "../context";
import type { SpanOptions } from "../ports/tracer";

function makeSeedCtx(overrides: Partial<ObservabilityContext> = {}): ObservabilityContext {
  return {
    requestId: "req-1",
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    locale: defaultLocale as Locale,
    tenantId: null,
    userId: null,
    ...overrides,
  };
}

describe("obsContext — Phase 19 / CTX-01 / D-06 ALS carrier", () => {
  test("Test 1: obsContext is a single AsyncLocalStorage instance (module-level singleton)", async () => {
    // Re-import via the package-internal path: should return the SAME instance.
    const mod = await import("../context");
    expect(mod.obsContext).toBe(obsContext);
    expect(obsContext instanceof AsyncLocalStorage).toBe(true);
  });

  test("Test 2: obsContext.run seeds the store; getObsContext outside any run returns undefined", () => {
    const seed = makeSeedCtx({ requestId: "req-2" });
    const inside = obsContext.run(seed, () => getObsContext());
    expect(inside).toBeDefined();
    expect(inside?.requestId).toBe("req-2");
    // Outside any run: undefined (defensive contract).
    const outside = getObsContext();
    expect(outside).toBeUndefined();
  });

  test("Test 3: setTenantContext mutates existing store in place — no nested .run", () => {
    const seed = makeSeedCtx({ tenantId: null, userId: null });
    obsContext.run(seed, () => {
      setTenantContext({ tenantId: "t1", userId: "u1" });
      const store = getObsContext();
      expect(store?.tenantId).toBe("t1");
      expect(store?.userId).toBe("u1");
      // Reference identity: same object reference (mutation, not replacement).
      expect(store).toBe(seed);
    });
  });

  test("Test 4: setSpan mutates existing store in place — no nested .run", () => {
    const seed = makeSeedCtx({ traceId: "0".repeat(32), spanId: "0".repeat(16) });
    const newTraceId = "f".repeat(32);
    const newSpanId = "e".repeat(16);
    obsContext.run(seed, () => {
      setSpan({ traceId: newTraceId, spanId: newSpanId });
      const store = getObsContext();
      expect(store?.traceId).toBe(newTraceId);
      expect(store?.spanId).toBe(newSpanId);
      expect(store).toBe(seed);
    });
  });

  test("Test 5: setLocale mutates existing store in place — no nested .run", () => {
    const seed = makeSeedCtx({ locale: "en" as Locale });
    obsContext.run(seed, () => {
      setLocale("pt-BR" as Locale);
      expect(getObsContext()?.locale).toBe("pt-BR");
    });
  });

  test("Test 6: mutator helpers are no-ops outside any .run frame (do not throw)", () => {
    // No obsContext.run() wrapping — calls must silently succeed.
    expect(() => setTenantContext({ tenantId: "t", userId: "u" })).not.toThrow();
    expect(() => setSpan({ traceId: "a".repeat(32), spanId: "b".repeat(16) })).not.toThrow();
    expect(() => setLocale("en" as Locale)).not.toThrow();
    // And getObsContext still returns undefined.
    expect(getObsContext()).toBeUndefined();
  });

  test("Test 7 (D-24 hygiene): context.ts source contains no banned ALS mutator", async () => {
    const source = await Bun.file(
      "packages/observability/src/context.ts",
    ).text();
    // Construct the banned token dynamically so this test file itself is not
    // flagged by the Plan 08 grep rule (belt-and-suspenders for the repo-wide
    // `grep -rn "\\.enter{W}ith(" packages/` sweep — doc literal split).
    const banned = `.${"enter"}${"With"}(`;
    expect(source.includes(banned)).toBe(false);
  });

  test("Test 8 (SpanOptions.links widening is typecheck-compatible)", () => {
    // Compile-time check via `satisfies` — will fail typecheck if widening missing.
    const opts: SpanOptions = {
      attributes: { foo: "bar" },
      kind: "server",
      links: [
        { traceId: "a".repeat(32), spanId: "b".repeat(16) },
        { traceId: "c".repeat(32), spanId: "d".repeat(16) },
      ],
    };
    expect(opts.links?.length).toBe(2);
    expect(opts.links?.[0].traceId.length).toBe(32);
    expect(opts.links?.[0].spanId.length).toBe(16);
  });
});

describe("obsContext — barrel exports from @baseworks/observability", () => {
  test("all six identifiers re-exported from the public barrel", async () => {
    // Barrel imports transitively pull in scrub-pii which imports @baseworks/config;
    // mock the config module to avoid t3-env validation failures in this unit test.
    const { mock } = await import("bun:test");
    mock.module("@baseworks/config", () => ({
      env: { OBS_PII_DENY_EXTRA_KEYS: "" },
    }));
    const mod = await import(`../index?t=${Date.now()}`);
    expect(typeof (mod as { obsContext?: unknown }).obsContext).toBe("object");
    expect(typeof (mod as { getObsContext?: unknown }).getObsContext).toBe(
      "function",
    );
    expect(typeof (mod as { setTenantContext?: unknown }).setTenantContext).toBe(
      "function",
    );
    expect(typeof (mod as { setSpan?: unknown }).setSpan).toBe("function");
    expect(typeof (mod as { setLocale?: unknown }).setLocale).toBe("function");
    // ObservabilityContext is a type — not a runtime value; skip runtime check.
  });
});
