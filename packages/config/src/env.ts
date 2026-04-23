import { createEnv } from "@t3-oss/env-core";
import ipaddr from "ipaddr.js";
import { z } from "zod";

/**
 * Server environment schema with conditional validation for payment providers.
 *
 * PAYMENT_PROVIDER defaults to "stripe". When set to "pagarme", the env
 * validation requires PAGARME_SECRET_KEY to be present (T-10-09).
 */
const serverSchema = {
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  INSTANCE_ROLE: z.enum(["api", "worker", "all"]).default("all"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(["stripe", "pagarme"]).optional().default("stripe"),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PAGARME_SECRET_KEY: z.string().min(1).optional(),
  PAGARME_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Observability adapter ports (Phase 17 / OBS-04 / D-07).
  // Phase 18 widens ERROR_TRACKER to include pino/sentry/glitchtip + adds
  // SENTRY_DSN/GLITCHTIP_DSN/RELEASE/SENTRY_ENVIRONMENT/OBS_PII_DENY_EXTRA_KEYS;
  // Phase 21 widens TRACER and METRICS_PROVIDER to include "otel" + adds
  // OTEL_EXPORTER_OTLP_ENDPOINT.
  TRACER: z.enum(["noop"]).optional().default("noop"),
  METRICS_PROVIDER: z.enum(["noop"]).optional().default("noop"),
  ERROR_TRACKER: z
    .enum(["noop", "pino", "sentry", "glitchtip"])
    .optional()
    .default("pino"),
  SENTRY_DSN: z.string().url().optional(),
  GLITCHTIP_DSN: z.string().url().optional(),
  RELEASE: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  OBS_PII_DENY_EXTRA_KEYS: z.string().optional(),
  // Phase 19 D-07/D-08 — inbound traceparent trust policy.
  // Default undefined → never-trust (fresh server-side trace). CIDR syntax
  // validated crash-hard by validateObservabilityEnv() at startup.
  OBS_TRUST_TRACEPARENT_FROM: z.string().optional(),
  OBS_TRUST_TRACEPARENT_HEADER: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_URL: z.string().url().default("http://localhost:5173"),
  WORKER_HEALTH_PORT: z.coerce.number().default(3001),
};

export const env = createEnv({
  server: serverSchema,
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

/**
 * Validate that the required payment provider secrets are present.
 * Must be called at startup to prevent runtime crashes on first billing operation.
 *
 * Per T-10-09: Prevents the app from starting with PAYMENT_PROVIDER=pagarme
 * but no PAGARME_SECRET_KEY configured.
 *
 * @throws Error if required provider secrets are missing
 */
export function validatePaymentProviderEnv(): void {
  const provider = env.PAYMENT_PROVIDER ?? "stripe";

  // Test environments are allowed to boot without real provider keys so the
  // billing module can be imported by the test runner. Production and
  // development must have the active provider's key set.
  const isTest = env.NODE_ENV === "test";

  if (provider === "pagarme" && !env.PAGARME_SECRET_KEY) {
    if (isTest) {
      console.warn(
        "[env] WARNING: PAGARME_SECRET_KEY is not set (NODE_ENV=test).",
      );
    } else {
      throw new Error(
        "PAGARME_SECRET_KEY is required when PAYMENT_PROVIDER=pagarme. " +
          "Set PAGARME_SECRET_KEY in your environment.",
      );
    }
  }

  if (provider === "stripe" && !env.STRIPE_SECRET_KEY) {
    // WR-05: Must throw symmetrically with the Pagar.me branch -- a missing
    // Stripe key in a stripe-configured deployment is a fatal startup error.
    if (isTest) {
      console.warn(
        "[env] WARNING: STRIPE_SECRET_KEY is not set (NODE_ENV=test).",
      );
    } else {
      throw new Error(
        "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe. " +
          "Set STRIPE_SECRET_KEY in your environment.",
      );
    }
  }
}

/**
 * Validate that the required observability secrets are present for the
 * currently-selected adapter. Must be called at startup (after `sdk.start()`
 * per D-06) to prevent runtime crashes on first observability operation.
 *
 * Phase 18 filled in the pino/sentry/glitchtip branches for ERROR_TRACKER —
 * sentry and glitchtip throw when their DSN is missing (crash-hard per D-09).
 * Phase 21 fills in the OTEL_EXPORTER_OTLP_ENDPOINT branches for TRACER +
 * METRICS_PROVIDER.
 *
 * Mirrors validatePaymentProviderEnv() — same crash-hard discipline, same
 * per-adapter switch shape (D-08, D-09).
 *
 * @throws Error if a selected adapter is missing its required env keys
 */
export function validateObservabilityEnv(): void {
  // Test environments are allowed to boot without real observability DSNs so
  // downstream packages can be imported by the test runner. Production and
  // development must have the active adapter's DSN set.
  const isTest = env.NODE_ENV === "test";

  // ERROR_TRACKER branch — Phase 18 fills pino/sentry/glitchtip (D-09).
  switch (env.ERROR_TRACKER ?? "pino") {
    case "noop":
    case "pino":
      // No required env vars for these adapters.
      break;
    case "sentry":
      if (!env.SENTRY_DSN) {
        if (isTest) {
          console.warn(
            "[env] WARNING: SENTRY_DSN is not set (NODE_ENV=test).",
          );
        } else {
          throw new Error(
            "SENTRY_DSN is required when ERROR_TRACKER=sentry. " +
              "Set SENTRY_DSN in your environment.",
          );
        }
      }
      break;
    case "glitchtip":
      if (!env.GLITCHTIP_DSN) {
        if (isTest) {
          console.warn(
            "[env] WARNING: GLITCHTIP_DSN is not set (NODE_ENV=test).",
          );
        } else {
          throw new Error(
            "GLITCHTIP_DSN is required when ERROR_TRACKER=glitchtip. " +
              "Set GLITCHTIP_DSN in your environment.",
          );
        }
      }
      break;
    // default arm intentionally omitted — Zod enum already rejects unknown values
    // at env-import time, mirroring validatePaymentProviderEnv() which trusts
    // its enum-typed PAYMENT_PROVIDER for the same reason.
  }

  // TRACER branch — Phase 17 noop only.
  switch (env.TRACER ?? "noop") {
    case "noop":
      break;
    // Phase 21 inserts case "otel": require OTEL_EXPORTER_OTLP_ENDPOINT.
  }

  // METRICS_PROVIDER branch — Phase 17 noop only.
  switch (env.METRICS_PROVIDER ?? "noop") {
    case "noop":
      break;
    // Phase 21 inserts case "otel": require OTEL_EXPORTER_OTLP_ENDPOINT.
  }

  // Phase 19 D-08 — CIDR syntax validation for inbound traceparent trust policy.
  // Crash-hard on malformed syntax; empty/unset is allowed (default never-trust
  // per D-07). Mirrors ERROR_TRACKER isTest soft-warn discipline above.
  //
  // NOTE: ipaddr.js v2 is LENIENT about short-form IPv4 — e.g., "10.0/8" is
  // parsed as "0.0.0.10/8", and "10/8" as "0.0.0.10/8". That silent rewrite
  // would be catastrophic for a trust allow-list: an operator typing
  // "10.0/8" intending the 10.0.0.0 private range would unknowingly trust
  // only 0.0.0.10. We enforce canonical form by requiring a full 4-octet
  // IPv4 literal (three dots) when `ipaddr` classifies the entry as IPv4.
  // IPv6 short-form ("::1", "fd00::") is allowed because those are the
  // RFC 5952 canonical notations and ipaddr.js rejects IPv6 strings
  // without colons (e.g., "fd00/8" throws).
  if (env.OBS_TRUST_TRACEPARENT_FROM) {
    const cidrs = env.OBS_TRUST_TRACEPARENT_FROM.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const cidr of cidrs) {
      const reportInvalid = (): void => {
        const msg =
          `Invalid CIDR in OBS_TRUST_TRACEPARENT_FROM: "${cidr}". ` +
          `Expected IPv4 (e.g., 10.0.0.0/8) or IPv6 (e.g., ::1/128) notation.`;
        if (isTest) {
          console.warn(`[env] WARNING: ${msg}`);
        } else {
          throw new Error(msg);
        }
      };

      let parsed: ReturnType<typeof ipaddr.parseCIDR> | undefined;
      try {
        parsed = ipaddr.parseCIDR(cidr);
      } catch {
        reportInvalid();
        continue;
      }

      // Reject non-canonical short-form IPv4 (ipaddr.js leniency bug-guard).
      // A canonical IPv4 literal has exactly three dots (four octets).
      const [addr] = parsed;
      if (addr.kind() === "ipv4") {
        const hostPart = cidr.split("/")[0] ?? "";
        const dotCount = (hostPart.match(/\./g) ?? []).length;
        if (dotCount !== 3) {
          reportInvalid();
        }
      }
    }
  }
}

/**
 * Assert that REDIS_URL is present when the instance role requires it.
 * Roles "worker" and "all" need Redis for BullMQ job processing.
 *
 * @returns The validated REDIS_URL string
 * @throws Error if REDIS_URL is missing for a role that requires it
 */
export function assertRedisUrl(role: string, redisUrl?: string): string {
  if ((role === "worker" || role === "all") && !redisUrl) {
    throw new Error(
      `REDIS_URL is required when INSTANCE_ROLE is "${role}". Set REDIS_URL in your environment.`,
    );
  }
  return redisUrl as string;
}
