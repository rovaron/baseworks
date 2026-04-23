/**
 * Unit tests for `scrubPii` (Phase 18 / ERR-04 / D-12, D-13).
 *
 * Exercises the full contract:
 * - Purity (no input mutation, deterministic)
 * - Default denylist (17 keys, case-insensitive, recursive)
 * - Legitimate context keys survive (tenantId, request_id, command, etc.)
 * - Regex patterns (email, CPF, CNPJ, Stripe key, Bearer token) applied to string leaves
 * - Webhook-route rule (drops request.data on /api/webhooks/** URLs)
 * - OBS_PII_DENY_EXTRA_KEYS env extension is additive (does NOT remove defaults)
 * - Fixture conformance: every PII_FIXTURE yields expected redaction
 *
 * Env-extension describe uses dynamic `await import("../scrub-pii")` AFTER
 * installing `mock.module("@baseworks/config", ...)` because `scrub-pii.ts`
 * reads `env.OBS_PII_DENY_EXTRA_KEYS` eagerly at module init via an IIFE.
 * A static top-level import would resolve the module BEFORE mock.module
 * takes effect, and the DENY_SET would already be built with the real env.
 */

import { describe, test, expect } from "bun:test";
import { PII_FIXTURES } from "../../adapters/__tests__/pii-fixtures";
import { scrubPii, DEFAULT_DENY_KEYS } from "../scrub-pii";

/**
 * Helper: build a single-key object, scrub it, and assert the value no longer
 * contains the given secret AND is marked with a `[redacted...]` prefix.
 */
function assertDenyKey(key: string, secret = "secret-value-xyzzy"): void {
  const input = { [key]: secret } as Record<string, unknown>;
  const out = scrubPii(input) as Record<string, unknown>;
  expect(JSON.stringify(out)).not.toContain(secret);
  expect(String(out[key])).toMatch(/^\[redacted/);
}

describe("scrubPii — purity contract", () => {
  test("does not mutate input", () => {
    const input = {
      request: { headers: { authorization: "Bearer secret" } },
      extra: { password: "pw", nested: { email: "x@y.com" } },
      tenantId: "tnt-1",
    };
    const clone = JSON.parse(JSON.stringify(input));
    scrubPii(input);
    expect(input).toEqual(clone);
  });

  test("is deterministic", () => {
    const input = {
      extra: { password: "pw", tenantId: "t-1" },
      request: { url: "/api/webhooks/stripe", data: { secret: "s" } },
    };
    const a = scrubPii(JSON.parse(JSON.stringify(input)));
    const b = scrubPii(JSON.parse(JSON.stringify(input)));
    expect(a).toEqual(b);
  });

  test("returns null for null/undefined input", () => {
    expect(scrubPii(null)).toBeNull();
    expect(scrubPii(undefined)).toBeNull();
  });
});

describe("scrubPii — default denylist", () => {
  test("redacts password", () => assertDenyKey("password"));
  test("redacts passwd", () => assertDenyKey("passwd"));
  test("redacts secret", () => assertDenyKey("secret"));
  test("redacts token", () => assertDenyKey("token"));
  test("redacts authorization", () => assertDenyKey("authorization"));
  test("redacts cookie", () => assertDenyKey("cookie"));
  test("redacts x-api-key", () => assertDenyKey("x-api-key"));
  test("redacts sessionId", () => assertDenyKey("sessionId"));
  test("redacts session", () => assertDenyKey("session"));
  test("redacts csrf", () => assertDenyKey("csrf"));
  test("redacts stripeCustomerId", () => assertDenyKey("stripeCustomerId"));
  test("redacts stripe_secret", () => assertDenyKey("stripe_secret"));
  test("redacts pagarme_secret", () => assertDenyKey("pagarme_secret"));
  test("redacts apiKey", () => assertDenyKey("apiKey"));
  test("redacts email", () => assertDenyKey("email", "alice-secret-xyzzy"));
  test("redacts cpf", () => assertDenyKey("cpf"));
  test("redacts cnpj", () => assertDenyKey("cnpj"));

  test("DEFAULT_DENY_KEYS export contains all 17 keys", () => {
    expect(DEFAULT_DENY_KEYS.length).toBe(17);
  });

  test("denylist is case-insensitive (PASSWORD)", () => {
    const out = scrubPii({ PASSWORD: "sekret" });
    expect(JSON.stringify(out)).not.toContain("sekret");
  });

  test("denylist walks recursively through nested objects", () => {
    const out = scrubPii({
      level1: { level2: { level3: { password: "deep-secret" } } },
    });
    expect(JSON.stringify(out)).not.toContain("deep-secret");
  });

  test("denylist walks through arrays", () => {
    const out = scrubPii({
      items: [{ password: "arr-secret" }, { token: "arr-token" }],
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("arr-secret");
    expect(s).not.toContain("arr-token");
  });
});

describe("scrubPii — context keys survive", () => {
  test("preserves tenantId", () => {
    const out = scrubPii({ tenantId: "tnt-alpha" }) as Record<string, unknown>;
    expect(out.tenantId).toBe("tnt-alpha");
  });

  test("preserves user_id", () => {
    const out = scrubPii({ user_id: "u-123" }) as Record<string, unknown>;
    expect(out.user_id).toBe("u-123");
  });

  test("preserves request_id", () => {
    const out = scrubPii({ request_id: "req-7" }) as Record<string, unknown>;
    expect(out.request_id).toBe("req-7");
  });

  test("preserves command", () => {
    const out = scrubPii({ command: "createTenant" }) as Record<string, unknown>;
    expect(out.command).toBe("createTenant");
  });

  test("preserves queryName", () => {
    const out = scrubPii({ queryName: "listInvoices" }) as Record<string, unknown>;
    expect(out.queryName).toBe("listInvoices");
  });

  test("preserves jobId", () => {
    const out = scrubPii({ jobId: "job-42" }) as Record<string, unknown>;
    expect(out.jobId).toBe("job-42");
  });

  test("preserves queue", () => {
    const out = scrubPii({ queue: "billing-sync" }) as Record<string, unknown>;
    expect(out.queue).toBe("billing-sync");
  });

  test("preserves route", () => {
    const out = scrubPii({ route: "/api/users/:id" }) as Record<string, unknown>;
    expect(out.route).toBe("/api/users/:id");
  });

  test("preserves method", () => {
    const out = scrubPii({ method: "POST" }) as Record<string, unknown>;
    expect(out.method).toBe("POST");
  });

  test("preserves code", () => {
    const out = scrubPii({ code: "NOT_FOUND" }) as Record<string, unknown>;
    expect(out.code).toBe("NOT_FOUND");
  });
});

describe("scrubPii — regex patterns", () => {
  test("redacts email in string leaf", () => {
    const out = scrubPii({ note: "reach user at alice@example.com today" });
    const s = JSON.stringify(out);
    expect(s).not.toContain("alice@example.com");
    expect(s).toContain("today");
  });

  test("redacts CPF pattern in string leaf", () => {
    const out = scrubPii({ note: "customer cpf 123.456.789-00 was rejected" });
    const s = JSON.stringify(out);
    expect(s).not.toContain("123.456.789-00");
    expect(s).toContain("rejected");
  });

  test("redacts Stripe sk_live key pattern in string leaf", () => {
    const out = scrubPii({ debug: "attempted with sk_live_abcXYZ12345 then failed" });
    const s = JSON.stringify(out);
    expect(s).not.toContain("sk_live_abcXYZ12345");
    expect(s).toContain("failed");
  });

  test("redacts Bearer token in string leaf", () => {
    const out = scrubPii({ ctx: "header was Bearer tok_abc-123.xyz and failed" });
    const s = JSON.stringify(out);
    expect(s).not.toContain("tok_abc-123.xyz");
    expect(s).toContain("failed");
  });
});

describe("scrubPii — webhook route rule", () => {
  test("drops request.data entirely when url matches /api/webhooks/", () => {
    const out = scrubPii({
      request: {
        url: "https://api.example.com/api/webhooks/stripe",
        data: { secret: "should-be-gone" },
      },
    });
    const req = (out as { request?: { data?: unknown } }).request;
    expect(req?.data).toBeUndefined();
  });

  test("preserves request.data on non-webhook URLs", () => {
    const out = scrubPii({
      request: {
        url: "https://api.example.com/api/users",
        data: { name: "alice" },
      },
    });
    const req = (out as { request?: { data?: { name?: string } } }).request;
    expect(req?.data).toBeDefined();
    expect(req?.data?.name).toBe("alice");
  });
});

describe("scrubPii — OBS_PII_DENY_EXTRA_KEYS env extension", () => {
  test("extends denylist additively with custom keys", async () => {
    const { mock } = await import("bun:test");
    mock.module("@baseworks/config", () => ({
      env: { OBS_PII_DENY_EXTRA_KEYS: "customerRef,internalApiKey" },
    }));
    // Dynamic import AFTER mock.module — forces DENY_SET IIFE to read mocked env.
    const mod = await import(`../scrub-pii?t=${Date.now()}`);
    const out = mod.scrubPii({
      customerRef: "cust_12345",
      internalApiKey: "int_key_xyz",
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("cust_12345");
    expect(s).not.toContain("int_key_xyz");
  });

  test("default keys continue to redact when extra keys are set", async () => {
    const { mock } = await import("bun:test");
    mock.module("@baseworks/config", () => ({
      env: { OBS_PII_DENY_EXTRA_KEYS: "customerRef" },
    }));
    const mod = await import(`../scrub-pii?t=${Date.now()}_b`);
    const out = mod.scrubPii({
      password: "pw-still-redacted",
      email: "still@redacted.com",
    });
    const s = JSON.stringify(out);
    expect(s).not.toContain("pw-still-redacted");
    expect(s).not.toContain("still@redacted.com");
  });
});

describe("scrubPii — fixture conformance", () => {
  for (const fixture of PII_FIXTURES) {
    test(fixture.name, () => {
      // Build a combined event mirroring what the Sentry/pino adapter would emit:
      // top-level fields are the scope overrides + the raw event.
      const merged: Record<string, unknown> = {};
      if (fixture.input.scope) {
        if (fixture.input.scope.tenantId !== undefined) {
          merged.tenantId = fixture.input.scope.tenantId;
        }
        if (fixture.input.scope.extra) {
          merged.extra = fixture.input.scope.extra;
        }
        if (fixture.input.scope.tags) {
          merged.tags = fixture.input.scope.tags;
        }
        if (fixture.input.scope.user) {
          merged.user = fixture.input.scope.user;
        }
      }
      if (fixture.input.event) {
        Object.assign(merged, fixture.input.event);
      }
      // Include err.message so message-based fixtures cover the regex path.
      if (fixture.input.err instanceof Error) {
        merged.message = fixture.input.err.message;
      }

      const scrubbed = scrubPii(merged);
      const serialized = JSON.stringify(scrubbed);

      for (const secret of fixture.shouldNotAppear ?? []) {
        expect(serialized).not.toContain(secret);
      }
      for (const survivor of fixture.shouldSurvive ?? []) {
        expect(serialized).toContain(survivor);
      }

      // Special-case: webhook route rule drops request.data entirely.
      if (fixture.name === "webhook-route-drops-request-data") {
        const req = (scrubbed as { request?: { data?: unknown } }).request;
        expect(req?.data).toBeUndefined();
      }
    });
  }
});
