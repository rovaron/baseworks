// packages/modules/notifications/src/index.ts
import type { ModuleDefinition } from "@baseworks/shared";

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
  events: ["notification.created"],
} satisfies ModuleDefinition;
