// packages/modules/notifications/src/routes.ts
import { Elysia } from "elysia";
import { userChannel } from "./channels/in-app";
import { createWebhook } from "./commands/create-webhook";
import { deleteWebhook } from "./commands/delete-webhook";
import { markAllRead } from "./commands/mark-all-read";
import { markRead } from "./commands/mark-read";
import { redeliverWebhook } from "./commands/redeliver-webhook";
import { rotateWebhookSecret } from "./commands/rotate-webhook-secret";
import { updateWebhook } from "./commands/update-webhook";
import { listNotifications } from "./queries/list-notifications";
import { listWebhookDeliveries } from "./queries/list-webhook-deliveries";
import { listWebhooks } from "./queries/list-webhooks";
import { unreadCount } from "./queries/unread-count";
import { getSseBridge } from "./sse/runtime"; // returns the process SseBridge (Task 7)

/**
 * Notifications HTTP routes. Statically chained (`.use(notificationRoutes)`) in
 * apps/api's scoped band, AFTER tenantMiddleware + the handlerCtx derive, so
 * `ctx.handlerCtx` (with tenantId/userId/withTenant) is guaranteed present. It is
 * chained as the concrete plugin (not via the registry) so its route types reach
 * Eden Treaty's `App` inference.
 *
 * Every read/write of `notification*` is RLS-scoped via handlerCtx.withTenant
 * (inside the query/command) AND filtered by recipient_user_id = ctx.userId.
 *
 * `/stream` is the SSE endpoint: it registers an emitter on the per-user Redis
 * channel via the refcounted SseBridge and tears it down when the client
 * disconnects. The cleanup is captured in a request-scoped closure (NOT on the
 * controller) so the ReadableStream `cancel()` — which runs with `this` bound to
 * the source object — reliably unsubscribes (verified: the bridge refcount
 * returns to empty on disconnect).
 */
export const notificationRoutes = new Elysia({ prefix: "/api/notifications" })
  .get("/", async ({ handlerCtx, query }: any) =>
    listNotifications(
      {
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
        unreadOnly: query.unreadOnly === "true",
      },
      handlerCtx,
    ),
  )
  .get("/unread-count", async ({ handlerCtx }: any) => unreadCount({}, handlerCtx))
  .post("/:id/read", async ({ handlerCtx, params }: any) => markRead({ id: params.id }, handlerCtx))
  .post("/read-all", async ({ handlerCtx }: any) => markAllRead({}, handlerCtx))
  .get("/stream", ({ handlerCtx }: any) => {
    const channel = userChannel(handlerCtx.tenantId, handlerCtx.userId);
    const bridge = getSseBridge();
    let cleanup: (() => Promise<void>) | undefined;
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(": connected\n\n"));
        const unsub = await bridge.subscribe(channel, (msg) =>
          controller.enqueue(enc.encode(`data: ${msg}\n\n`)),
        );
        const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 25_000);
        cleanup = async () => {
          clearInterval(ka);
          await unsub();
        };
      },
      async cancel() {
        await cleanup?.();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  })
  .post("/webhooks", async ({ handlerCtx, body }: any) => createWebhook(body, handlerCtx))
  .get("/webhooks", async ({ handlerCtx }: any) => listWebhooks({}, handlerCtx))
  .patch("/webhooks/:id", async ({ handlerCtx, params, body }: any) =>
    // Path id is authoritative — spread body first so a body-supplied `id` can't override it.
    updateWebhook({ ...body, id: params.id }, handlerCtx),
  )
  .delete("/webhooks/:id", async ({ handlerCtx, params }: any) =>
    deleteWebhook({ id: params.id }, handlerCtx),
  )
  .post("/webhooks/:id/rotate-secret", async ({ handlerCtx, params }: any) =>
    rotateWebhookSecret({ id: params.id }, handlerCtx),
  )
  .get("/webhooks/:id/deliveries", async ({ handlerCtx, params, query }: any) =>
    listWebhookDeliveries(
      {
        webhookId: params.id,
        status: query.status,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      },
      handlerCtx,
    ),
  )
  .post("/webhooks/deliveries/:deliveryId/redeliver", async ({ handlerCtx, params }: any) =>
    redeliverWebhook({ deliveryId: params.deliveryId }, handlerCtx),
  );
