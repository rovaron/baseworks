// packages/modules/notifications/src/index.ts
import type { ModuleDefinition } from "@baseworks/shared";
import { markAllRead } from "./commands/mark-all-read";
import { markRead } from "./commands/mark-read";
import { notify } from "./commands/notify";
import { sendTransactionalEmail } from "./commands/send-transactional-email";
import { deliver } from "./jobs/deliver";
import { deliverWebhook } from "./jobs/deliver-webhook";
import { pruneWebhookDeliveries } from "./jobs/prune-webhook-deliveries";
import { listNotifications } from "./queries/list-notifications";
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

export default {
  name: "notifications",
  routes: notificationRoutes,
  commands: {
    "notifications:notify": notify,
    "notifications:mark-read": markRead,
    "notifications:mark-all-read": markAllRead,
    "notifications:send-transactional-email": sendTransactionalEmail,
  },
  queries: {
    "notifications:list": listNotifications,
    "notifications:unread-count": unreadCount,
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
