// packages/modules/notifications/src/catalog.ts
import type { Channel } from "./channels/channel";

export type Category = "system" | "team" | "billing" | "files" | "security";
export type Severity = "info" | "success" | "warning" | "error";

export interface RenderedContent {
  title: string;
  body: string;
  url?: string;
  // actions are added by producers/later phases; render may seed defaults.
  actions?: unknown[];
}

export interface CatalogEntry {
  category: Category;
  severity: Severity;
  defaultChannels: Channel[];
  /** When true, users cannot opt out (security/transactional). */
  required?: boolean;
  /**
   * When false, this type never dispatches webhooks even if a tenant endpoint
   * subscribes to its category (for sensitive/internal-only notifications).
   * Defaults to true (webhook-eligible) when omitted.
   */
  webhookable?: boolean;
  render: (data: Record<string, unknown>) => RenderedContent;
}

/**
 * The notification type catalog. Adding a notification = one entry. Phase 1
 * seeds a single `system.test` entry to validate the shape; real types land
 * with their producers in later phases.
 */
export const notificationCatalog = {
  "system.test": {
    category: "system",
    severity: "info",
    defaultChannels: ["in-app"],
    render: (data) => ({
      title: "System notification",
      body: String((data as { message?: unknown }).message ?? ""),
    }),
  },
} satisfies Record<string, CatalogEntry>;

export type NotificationType = keyof typeof notificationCatalog;

/** Look up a catalog entry; throws on an unknown type (fail-loud for producers). */
export function getCatalogEntry(type: string): CatalogEntry {
  const entry = (notificationCatalog as Record<string, CatalogEntry>)[type];
  if (!entry) throw new Error(`Unknown notification type: "${type}"`);
  return entry;
}
