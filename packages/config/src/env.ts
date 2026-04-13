import { createEnv } from "@t3-oss/env-core";
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
