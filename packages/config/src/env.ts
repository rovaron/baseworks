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
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
