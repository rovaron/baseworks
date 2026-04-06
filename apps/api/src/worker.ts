import { env } from "@baseworks/config";
import { createDb } from "@baseworks/db";
import { ModuleRegistry } from "./core/registry";
import { logger } from "./lib/logger";

// Validate environment at startup (crashes on missing/invalid vars)
const _env = env;

// Create database instance
const db = createDb(env.DATABASE_URL);

// Create module registry in worker role (skips route attachment)
const registry = new ModuleRegistry({
  role: "worker",
  modules: ["example"],
});

// Load all configured modules
await registry.loadAll();

logger.info(
  { modules: registry.getLoadedNames(), role: "worker" },
  "Worker started",
);

// BullMQ worker setup added in Phase 3

// Graceful shutdown handler
process.on("SIGTERM", () => {
  logger.info("Worker shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("Worker shutting down...");
  process.exit(0);
});
