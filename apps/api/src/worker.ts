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
        async (job) => {
          // Extract request ID from job data for correlated logging (D-09)
          const jobRequestId = job.data?._requestId;
          const jobLog = jobRequestId
            ? logger.child({ requestId: jobRequestId, jobId: job.id, queue: jobDef.queue })
            : logger.child({ jobId: job.id, queue: jobDef.queue });
          jobLog.info("Job started");
          try {
            const result = await jobDef.handler(job.data);
            jobLog.info("Job completed");
            return result;
          } catch (err) {
            jobLog.error({ err: String(err) }, "Job handler error");
            throw err;
          }
        },
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

// Health check HTTP server for Docker/infrastructure probes (D-06)
const WORKER_HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT) || 3001;

const healthServer = Bun.serve({
  port: WORKER_HEALTH_PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    if (url.pathname !== "/health") {
      return new Response("Not Found", { status: 404 });
    }

    const checks: Record<string, { status: string; error?: string; active?: number; queues?: string[] }> = {};

    // Redis connectivity
    try {
      const { getRedisConnection } = await import("@baseworks/queue");
      const redis = getRedisConnection(redisUrl);
      await redis.ping();
      checks.redis = { status: "up" };
    } catch (err) {
      checks.redis = { status: "down", error: "Failed to connect" };
    }

    // Worker/queue status
    checks.workers = {
      status: workers.length > 0 ? "up" : "down",
      active: workers.length,
      queues: workers.map((w) => w.name),
    };

    const allUp = checks.redis?.status === "up" && workers.length > 0;

    return Response.json({
      status: allUp ? "ok" : "degraded",
      role: "worker",
      checks,
      uptime: Math.round(process.uptime()),
    });
  },
});

logger.info({ port: WORKER_HEALTH_PORT }, "Worker health server started");

// Graceful shutdown handler
async function shutdown() {
  logger.info("Worker shutting down...");
  healthServer.stop();
  await Promise.all(workers.map((w) => w.close()));
  await closeConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
