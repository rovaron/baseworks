import { env } from "@baseworks/config";
import { createQueue } from "@baseworks/queue";
import type { Queue } from "bullmq";

/**
 * Auto-enqueue a `example-process-followup` job when an example record
 * is created.
 *
 * Per D-05 and Plan 15-02: the example module demonstrates all four
 * module surfaces (command, query, event, BullMQ job). The command
 * emits `example.created`; this hook subscribes to that event and
 * enqueues the follow-up job. Mirrors the canonical event-bus-hook
 * pattern in `packages/modules/billing/src/hooks/on-tenant-created.ts`.
 *
 * Registered as a listener on `example.created` via the TypedEventBus
 * provided by the module registry. Called once at API startup from
 * `apps/api/src/index.ts`.
 */

interface ExampleCreatedEvent {
  id: string;
  tenantId: string;
}

/**
 * Lazy-initialized BullMQ queue for example-process-followup.
 * Only created if REDIS_URL is available; falls back to a console log
 * when Redis is not configured (dev/test). Mirrors the `getEmailQueue`
 * pattern in `packages/modules/auth/src/auth.ts:15-21`.
 */
let followupQueue: Queue | null = null;
function getFollowupQueue(): Queue | null {
  if (!followupQueue && env.REDIS_URL) {
    followupQueue = createQueue("example-process-followup", env.REDIS_URL);
  }
  return followupQueue;
}

/**
 * Register example-module hooks on the event bus.
 *
 * Attaches an `example.created` listener that enqueues the follow-up
 * job onto the `example-process-followup` BullMQ queue. On error,
 * logs and does not rethrow -- failure of the hook MUST NOT crash
 * the originating command.
 *
 * @param eventBus - The TypedEventBus instance from the module registry.
 * @returns void
 */
export function registerExampleHooks(eventBus: {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
}): void {
  eventBus.on("example.created", async (data: unknown) => {
    const { id, tenantId } = data as ExampleCreatedEvent;

    try {
      const queue = getFollowupQueue();
      if (!queue) {
        // biome-ignore lint/suspicious/noConsole: graceful dev-without-Redis fallback
        console.log(
          `[example] Skipping process-followup enqueue for ${id} (REDIS_URL not set)`,
        );
        return;
      }

      await queue.add("example-process-followup", { exampleId: id, tenantId });
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: error path of a best-effort hook
      console.error(
        `[example] Failed to enqueue process-followup for ${id}:`,
        err,
      );
    }
  });
}
