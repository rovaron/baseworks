import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
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
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

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
