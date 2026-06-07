import "./telemetry";
import { env, assertRedisUrl, validatePaymentProviderEnv, validateObservabilityEnv } from "@baseworks/config";
import { createDb } from "@baseworks/db";
import { createWorker, closeConnection, getRedisConnection } from "@baseworks/queue";
import type { Worker } from "bullmq";
import { ModuleRegistry } from "./core/registry";
import { logger } from "./lib/logger";
import {
  getErrorTracker,
  getTracer,
  installGlobalErrorHandlers,
  resolveInstanceId,
  startHeartbeatPublisher,
  wrapCqrsBus,
  wrapEventBus,
} from "@baseworks/observability";
import { validateStorageEnv } from "@baseworks/storage";

// Validate environment at startup (crashes on missing/invalid vars)
const _env = env;

// Ensure REDIS_URL is present for worker role
const redisUrl = assertRedisUrl(env.INSTANCE_ROLE, env.REDIS_URL);

// Validate payment provider env vars at startup (T-10-09)
validatePaymentProviderEnv();
// Phase 18 — crash-hard on missing DSN for the selected ERROR_TRACKER (D-09).
validateObservabilityEnv();
// Phase 24 — crash-hard on missing storage adapter env or production-local (D-13/D-14).
validateStorageEnv();
// Phase 18 D-02 — register global uncaughtException + unhandledRejection handlers.
installGlobalErrorHandlers(getErrorTracker());

// Create database instance
const db = createDb(env.DATABASE_URL);

// Create module registry in worker role (skips route attachment)
const registry = new ModuleRegistry({
  role: "worker",
  modules: ["example", "billing"],
});

// Load all configured modules
await registry.loadAll();

// Phase 18 D-01 — wrap the CqrsBus so thrown handler exceptions are captured.
// External wrapper; zero edits to apps/api/src/core/cqrs.ts (D-01 invariant).
wrapCqrsBus(registry.getCqrs(), getErrorTracker());
// Phase 19 D-16 — wrap the EventBus so emit/on get producer/consumer spans.
// External wrapper; zero edits to apps/api/src/core/event-bus.ts (TRC-02 invariant).
wrapEventBus(registry.getEventBus(), getTracer());

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
        // Phase 18 D-04 — capture via ErrorTracker port. Single call site (this
        // loop) covers every module's jobs. Inner try/catch at line 45 stays
        // log-only to avoid double-reporting.
        getErrorTracker().captureException(err, {
          tags: { queue: jobDef.queue },
          extra: { jobId: job?.id, jobName },
        });
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

// Phase 22 / EXT-02 / D-14 — start the worker heartbeat publisher AFTER
// workers attach so getQueues() returns the actual queue list. The publisher
// uses raw redis.set (NOT the queue producer wrapper — Phase 20 D-02
// invariant; heartbeat is a self-report, not a producer/consumer pair).
const heartbeat = startHeartbeatPublisher({
  redis: getRedisConnection(redisUrl),
  instanceId: resolveInstanceId(),
  getQueues: () => workers.map((w) => w.name),
  intervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS,
  version: env.RELEASE,
  logger,
});
logger.info(
  { intervalMs: env.WORKER_HEARTBEAT_INTERVAL_MS, instanceId: resolveInstanceId() },
  "Worker heartbeat publisher started",
);

// Health check HTTP server for Docker/infrastructure probes (D-06)
const WORKER_HEALTH_PORT = env.WORKER_HEALTH_PORT;

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
  // Phase 22 / D-14 — clear heartbeat timer + DEL key BEFORE workers/redis close
  // so the dashboard transitions worker → absent immediately on graceful stop
  // (rather than waiting for TTL expiry).
  await heartbeat.stop();
  healthServer.stop();
  await Promise.all(workers.map((w) => w.close()));
  await closeConnection();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
