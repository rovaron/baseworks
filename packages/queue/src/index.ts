import { Queue, Worker } from "bullmq";
import type { Processor } from "bullmq";
import { getRedisConnection } from "./connection";
import type { WorkerConfig } from "./types";

/**
 * Create a BullMQ Queue with sensible defaults.
 *
 * Defaults:
 * - removeOnComplete: 3 days (259200 seconds)
 * - removeOnFail: 7 days (604800 seconds)
 * - attempts: 3 with exponential backoff starting at 1000ms
 */
export function createQueue(name: string, redisUrl: string): Queue {
  const connection = getRedisConnection(redisUrl);

  return new Queue(name, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 259200 },
      removeOnFail: { age: 604800 },
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
    },
  });
}

/**
 * Create a BullMQ Worker with inline processor (no worker threads).
 *
 * Worker threads (sandboxed processors) are NOT used because they are
 * broken on Bun runtime. All processors run inline in the main thread.
 *
 * Default concurrency: 5
 */
export function createWorker(
  name: string,
  processor: Processor,
  redisUrl: string,
  opts?: WorkerConfig,
): Worker {
  const connection = getRedisConnection(redisUrl);

  return new Worker(name, processor, {
    connection,
    concurrency: opts?.concurrency ?? 5,
  });
}

export { getRedisConnection, closeConnection } from "./connection";
export type { QueueConfig, WorkerConfig, EmailJobData } from "./types";
