// packages/modules/notifications/src/lib/webhook-queue.ts
import { env } from "@baseworks/config";
import { createQueue } from "@baseworks/queue";

/**
 * Lazily-created, memoized handle to the dedicated `notifications-webhook` queue.
 *
 * Separate from `notifications-deliver` so slow/flaky third-party POSTs don't
 * sit in the same worker lane as latency-sensitive transactional email. Returns
 * `null` when `REDIS_URL` is unset (dev/test) so callers degrade gracefully.
 */
let queue: ReturnType<typeof createQueue> | null = null;

export function getWebhookQueue(): ReturnType<typeof createQueue> | null {
  if (!queue && env.REDIS_URL) {
    queue = createQueue("notifications-webhook", env.REDIS_URL);
  }
  return queue;
}
