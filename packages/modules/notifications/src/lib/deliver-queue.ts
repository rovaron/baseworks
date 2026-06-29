// packages/modules/notifications/src/lib/deliver-queue.ts
import { env } from "@baseworks/config";
import { createQueue } from "@baseworks/queue";

/**
 * Lazily-created, memoized handle to the `notifications-deliver` queue.
 *
 * BullMQ's `Queue` opens a Redis connection on construction, so producers must
 * reuse one instance rather than building a fresh queue per call (cf. auth's
 * `getEmailQueue()`). Returns `null` when `REDIS_URL` is unset (dev/test) so
 * callers can fall back to a console log.
 */
let queue: ReturnType<typeof createQueue> | null = null;

export function getDeliverQueue(): ReturnType<typeof createQueue> | null {
  if (!queue && env.REDIS_URL) {
    queue = createQueue("notifications-deliver", env.REDIS_URL);
  }
  return queue;
}
