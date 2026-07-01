// packages/modules/notifications/src/index.ts
import type { ModuleDefinition } from "@baseworks/shared";
import { createWebhook } from "./commands/create-webhook";
import { deleteWebhook } from "./commands/delete-webhook";
import { markAllRead } from "./commands/mark-all-read";
import { markRead } from "./commands/mark-read";
import { notify } from "./commands/notify";
import { redeliverWebhook } from "./commands/redeliver-webhook";
import { rotateWebhookSecret } from "./commands/rotate-webhook-secret";
import { sendTransactionalEmail } from "./commands/send-transactional-email";
import { updateWebhook } from "./commands/update-webhook";
import { deliver } from "./jobs/deliver";
import { deliverWebhook } from "./jobs/deliver-webhook";
import { pruneWebhookDeliveries } from "./jobs/prune-webhook-deliveries";
import { listNotifications } from "./queries/list-notifications";
import { listWebhookDeliveries } from "./queries/list-webhook-deliveries";
import { listWebhooks } from "./queries/list-webhooks";
import { unreadCount } from "./queries/unread-count";
import { notificationRoutes } from "./routes";
import { ensureNotificationsRuntime } from "./sse/runtime";

// Wire the in-app adapter + SSE bridge at module load so both api and worker
// boots register delivery. Idempotent and a no-op without REDIS_URL.
ensureNotificationsRuntime();

export {
  type CatalogEntry,
  type Category,
  getCatalogEntry,
  type NotificationType,
  notificationCatalog,
  type Severity,
} from "./catalog";
export type { Channel, ChannelAdapter, DeliveryResult } from "./channels/channel";
export {
  type AdminWebhookRow,
  adminForceDisableWebhook,
  adminListAllWebhooks,
  adminListWebhookDeliveries,
  adminReenableWebhook,
} from "./commands/admin-webhooks";
// Re-exported so apps/api can static-chain the plugin with its precise Elysia
// type (Eden Treaty end-to-end typing).
export { notificationRoutes } from "./routes";

export default {
  name: "notifications",
  routes: notificationRoutes,
  commands: {
    "notifications:notify": notify,
    "notifications:mark-read": markRead,
    "notifications:mark-all-read": markAllRead,
    "notifications:send-transactional-email": sendTransactionalEmail,
    "notifications:create-webhook": createWebhook,
    "notifications:update-webhook": updateWebhook,
    "notifications:delete-webhook": deleteWebhook,
    "notifications:rotate-webhook-secret": rotateWebhookSecret,
    "notifications:redeliver-webhook": redeliverWebhook,
  },
  queries: {
    "notifications:list": listNotifications,
    "notifications:unread-count": unreadCount,
    "notifications:list-webhooks": listWebhooks,
    "notifications:list-webhook-deliveries": listWebhookDeliveries,
  },
  jobs: {
    "notifications-deliver": {
      queue: "notifications-deliver",
      handler: deliver,
    },
    "notifications-webhook": {
      queue: "notifications-webhook",
      handler: deliverWebhook,
      concurrency: 20,
    },
    "notifications-webhook-prune": {
      queue: "notifications-webhook-prune",
      handler: pruneWebhookDeliveries,
      repeat: { pattern: "0 3 * * *" }, // daily at 03:00
    },
  },
  events: ["notification.created"],
} satisfies ModuleDefinition;
