import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * Development-only fallback for BETTER_AUTH_SECRET shipped in
 * docker-compose.yml. A production boot must never accept this publicly-known
 * value — a known signing secret allows session/token forgery for any tenant
 * (audit: docker-default-auth-secret-in-prod).
 */
const DEV_AUTH_SECRET_DEFAULT = "development-secret-at-least-32-chars-long";

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
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    // docker-default-auth-secret-in-prod: fail-closed if a production deploy
    // is still using the committed dev default. Durable app-layer guard that
    // protects every deploy path, not just docker-compose.yml.
    .refine(
      (v) => !(process.env.NODE_ENV === "production" && v === DEV_AUTH_SECRET_DEFAULT),
      "BETTER_AUTH_SECRET must not be the development default in production",
    ),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  // C5 — platform-admin allowlist. Comma-separated email addresses granted
  // operator scope, independent of organization membership role. Parsed via
  // getAdminEmails().
  ADMIN_EMAILS: z.string().optional(),
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
  ERROR_TRACKER: z.enum(["noop", "pino", "sentry", "glitchtip"]).optional().default("pino"),
  SENTRY_DSN: z.string().url().optional(),
  GLITCHTIP_DSN: z.string().url().optional(),
  RELEASE: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  OBS_PII_DENY_EXTRA_KEYS: z.string().optional(),
  // Trust inbound W3C traceparent headers (default "true" = v1.3 always-trust
  // posture). Set "false" on public-internet ingress so the API ignores client
  // traceparents and always mints fresh trace ids (api-traceparent-always-trusted).
  OBS_TRUST_INBOUND_TRACEPARENT: z.enum(["true", "false"]).default("true"),
  RESEND_API_KEY: z.string().min(1).optional(),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_URL: z.string().url().default("http://localhost:5173"),
  WORKER_HEALTH_PORT: z.coerce.number().default(3001),
  // Phase 22 D-02 — bull-board read-only mode (default ON; crash-hard on typo per OPS-01).
  BULL_BOARD_READ_ONLY: z.enum(["true", "false"]).default("true"),
  // Phase 22 D-13 — worker heartbeat interval. Min 1000ms (1s), max 300000ms (5min).
  // TTL on heartbeat keys is 2× this value; "stale" threshold is 2×, "dead" is 5×.
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().min(1000).max(300_000).default(15_000),
  // Phase 26 / QUO-01 — default per-tenant storage quota in bytes. Applied as the
  // tenant_storage_usage.bytes_limit at tenant-creation time and used by
  // reserveQuota()'s COALESCE(bytes_limit, default) for legacy/NULL-limit rows
  // (D-11 per-tenant-override-or-env-default). Default 1 GiB (1073741824 bytes).
  STORAGE_DEFAULT_QUOTA_BYTES: z.coerce.number().int().positive().default(1073741824),
  // Phase 27 / UPL-04 — signed READ-URL TTL in seconds. 5–15 min window; default
  // 10 min. Bounds keep tokens short-lived (no long-lived shareable links) while
  // leaving enough slack for a slow client to start the download.
  STORAGE_SIGNED_URL_TTL_SEC: z.coerce.number().int().min(300).max(900).default(600),
  // Phase 31 / OPS-02 — retention window (days) for the weekly
  // cleanup-reap-soft-deleted job. Tombstones (deleted_at) older than this are
  // hard-deleted (storage objects + variant objects + DB row). Default 30.
  STORAGE_SOFT_DELETE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // Phase 31 / OPS-03 — top-N tenants by bytes_used surfaced in the storage
  // health contributor (/health/detailed). Default 10.
  STORAGE_HEALTH_TOP_TENANTS: z.coerce.number().int().positive().default(10),
  // Phase 31 / OPS-03 — internal adapter-reachability probe timeout (ms) for the
  // storage health contributor. Kept well under the aggregator's 4s contributor
  // race / 5s cache so a hung S3 stat() never consumes the whole budget. Default 1500.
  STORAGE_HEALTH_PROBE_MS: z.coerce.number().int().positive().default(1500),
};

export const env = createEnv({
  server: serverSchema,
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

/**
 * Parse the ADMIN_EMAILS allowlist into a normalized list of platform-admin
 * email addresses (C5). The value is comma-separated; each entry is trimmed
 * and lowercased, and empty entries are dropped. Returns [] when unset.
 */
export function getAdminEmails(): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

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
      console.warn("[env] WARNING: PAGARME_SECRET_KEY is not set (NODE_ENV=test).");
    } else {
      throw new Error(
        "PAGARME_SECRET_KEY is required when PAYMENT_PROVIDER=pagarme. " +
          "Set PAGARME_SECRET_KEY in your environment.",
      );
    }
  }

  // env-missing-webhook-secret-validation: a configured provider must also have
  // its webhook signing secret, otherwise webhook verification fails (or worse,
  // is silently skipped) the first time the provider POSTs an event.
  if (provider === "pagarme" && !env.PAGARME_WEBHOOK_SECRET) {
    if (isTest) {
      console.warn("[env] WARNING: PAGARME_WEBHOOK_SECRET is not set (NODE_ENV=test).");
    } else {
      throw new Error(
        "PAGARME_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=pagarme. " +
          "Set PAGARME_WEBHOOK_SECRET in your environment.",
      );
    }
  }

  if (provider === "stripe" && !env.STRIPE_SECRET_KEY) {
    // WR-05: Must throw symmetrically with the Pagar.me branch -- a missing
    // Stripe key in a stripe-configured deployment is a fatal startup error.
    if (isTest) {
      console.warn("[env] WARNING: STRIPE_SECRET_KEY is not set (NODE_ENV=test).");
    } else {
      throw new Error(
        "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe. " +
          "Set STRIPE_SECRET_KEY in your environment.",
      );
    }
  }

  // env-missing-webhook-secret-validation: mirror the Stripe secret-key check
  // for the webhook signing secret used by stripe.webhooks.constructEvent().
  if (provider === "stripe" && !env.STRIPE_WEBHOOK_SECRET) {
    if (isTest) {
      console.warn("[env] WARNING: STRIPE_WEBHOOK_SECRET is not set (NODE_ENV=test).");
    } else {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe. " +
          "Set STRIPE_WEBHOOK_SECRET in your environment.",
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
          console.warn("[env] WARNING: SENTRY_DSN is not set (NODE_ENV=test).");
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
          console.warn("[env] WARNING: GLITCHTIP_DSN is not set (NODE_ENV=test).");
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

  // Phase 20.1 D-12 — CIDR-based inbound traceparent trust gate removed.
  // OTel's default "always honor inbound traceparent" posture is acceptable
  // for v1.3. Production trust hardening is deferred per
  // .planning/phases/20.1-close-v13-milestone-gaps/20.1-CONTEXT.md.
}

/** The INSTANCE_ROLE union, reused to type role-aware helpers. */
type InstanceRole = (typeof env)["INSTANCE_ROLE"];

/**
 * Assert that REDIS_URL is present when the instance role requires it.
 * Roles "worker" and "all" need Redis for BullMQ job processing.
 *
 * env-assert-redis-unsafe-cast: the `role` parameter is typed as the
 * INSTANCE_ROLE union (not bare `string`), and the previous `redisUrl as string`
 * cast — which masked a possible `undefined` for the "api" role — is gone. For
 * roles that require Redis the throw above proves `redisUrl` is set; the "api"
 * role does not require Redis and must not consume the return value.
 *
 * @returns The validated REDIS_URL (empty string for the "api" role when unset)
 * @throws Error if REDIS_URL is missing for a role that requires it
 */
export function assertRedisUrl(role: InstanceRole, redisUrl?: string): string {
  if ((role === "worker" || role === "all") && !redisUrl) {
    throw new Error(
      `REDIS_URL is required when INSTANCE_ROLE is "${role}". Set REDIS_URL in your environment.`,
    );
  }
  return redisUrl ?? "";
}
