import { describe, test, expect, mock } from "bun:test";
import { defaultLocale, type Locale } from "@baseworks/i18n";

// The auth barrel transitively imports `./auth` which imports @baseworks/config
// (t3-env validation). The @baseworks/observability barrel transitively imports
// scrub-pii which also imports @baseworks/config. Mock config + auth BEFORE any
// SUT module is evaluated so env validation doesn't fire during a unit test.
// Mirrors the pattern at packages/modules/auth/src/__tests__/accept-invitation.test.ts
// (top-of-file mock.module + deferred dynamic import).
mock.module("@baseworks/config", () => ({
  env: { OBS_PII_DENY_EXTRA_KEYS: "" },
}));
mock.module("../src/auth", () => ({
  auth: { api: {} },
}));

// Dynamic imports AFTER mocks so module evaluation sees the mocked config.
const { obsContext } = (await import("@baseworks/observability")) as {
  obsContext: import("@baseworks/observability").ObservabilityContext extends infer T
    ? { run<R>(ctx: T, fn: () => R): R; getStore(): T | undefined }
    : never;
};
const { getLocale } = await import("../src/locale-context");

type ObsCtx = {
  requestId: string;
  traceId: string;
  spanId: string;
  locale: Locale;
  tenantId: string | null;
  userId: string | null;
};

function makeSeedCtx(overrides: Partial<ObsCtx> = {}): ObsCtx {
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

describe("locale-context — Phase 19 / CTX-01 / D-10 / D-11 migration", () => {
  test("Test 1 (D-11 surface preserved): getLocale is a zero-arg function returning Locale", () => {
    expect(typeof getLocale).toBe("function");
    expect(getLocale.length).toBe(0);
  });

  test("Test 2 (fallback outside request frame): returns defaultLocale", () => {
    // No obsContext.run wrapper — we are outside any request frame.
    expect(getLocale()).toBe(defaultLocale);
  });

  test("Test 3 (reads from obsContext when inside a .run frame)", () => {
    const seed = makeSeedCtx({ locale: "pt-BR" as Locale });
    const result = (obsContext as any).run(seed, () => getLocale());
    expect(result).toBe("pt-BR");
  });

  test("Test 4 (D-10 localeMiddleware deleted from barrel): import fails", async () => {
    const mod = await import("../src/index");
    expect(
      (mod as { localeMiddleware?: unknown }).localeMiddleware,
    ).toBeUndefined();
    // getLocale must still be re-exported from the barrel.
    expect(typeof (mod as { getLocale?: unknown }).getLocale).toBe("function");
  });

  test("Test 5 (D-10 per-module ALS + banned mutator deleted from file)", async () => {
    const source = await Bun.file(
      "packages/modules/auth/src/locale-context.ts",
    ).text();
    // Dynamic tokens so this test file itself is not flagged by the Plan 08
    // repo-wide grep sweep for the banned mutator / removed ALS symbol names.
    const banned = `.${"enter"}${"With"}(`;
    const asyncLs = `Async${"Local"}Storage`;
    const storeName = `locale${"Storage"}`;
    const storeTypeName = `Locale${"Store"}`;
    expect(source.includes(asyncLs)).toBe(false);
    expect(source.includes(banned)).toBe(false);
    expect(source.includes(storeName)).toBe(false);
    expect(source.includes(storeTypeName)).toBe(false);
  });

  test("Test 6 (D-12 cookie-parser moved out to apps/api)", async () => {
    const source = await Bun.file(
      "packages/modules/auth/src/locale-context.ts",
    ).text();
    const parserName = `parse${"Next"}${"Locale"}${"Cookie"}`;
    expect(source.includes(parserName)).toBe(false);
  });
});
