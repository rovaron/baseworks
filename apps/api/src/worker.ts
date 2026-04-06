import { env, assertRedisUrl } from "@baseworks/config";
import { createDb } from "@baseworks/db";
import { createWorker, closeConnection } from "@baseworks/queue";
import type { Worker } from "bullmq";
import { ModuleRegistry } from "./core/registry";
import { logger } from "./lib/logger";

// Validate environment at startup (crashes on missing/invalid vars)
const _env = env;

// Ensure REDIS_URL is present for worker role
const redisUrl = assertRedisUrl(env.INSTANCE_ROLE, env.REDIS_URL);

// Create database instance
const db = createDb(env.DATABASE_URL);

// Create module registry in worker role (skips route attachment)
const registry = new ModuleRegistry({
  role: "worker",
  modules: ["example", "billing"],
});

// Load all configured modules
await registry.loadAll();

// Start BullMQ Workers for all module-registered jobs
const workers: Worker[] = [];

for (const [name, def] of registry.getLoaded()) {
  if (def.jobs) {
    for (const [jobName, jobDef] of Object.entries(def.jobs)) {
      const worker = createWorker(
        jobDef.queue,
        async (job) => jobDef.handler(job.data),
        redisUrl,
      );

      worker.on("failed", (job, err) => {
        logger.error(
          { job: job?.id, queue: jobDef.queue, err: String(err) },
          "Job failed",
        );
      });

      worker.on("completed", (job) => {
        logger.debug(
          { job: job?.id, queue: jobDef.queue },
          "Job completed",
        );
      });

      workers.push(worker);
      logger.info(
        { module: name, job: jobName, queue: jobDef.queue },
        "Worker started for job",
      );
    }
  }
}

logger.info(
  { modules: registry.getLoadedNames(), role: "worker", workers: workers.length },
  "Worker started",
);

// Graceful shutdown handler
async function shutdown() {
  logger.info("Worker shutting down...");
  await Promise.all(workers.map((w) => w.close()));
  await closeConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
