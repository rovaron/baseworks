// packages/modules/notifications/src/lib/webhook-endpoint.ts

import type { notificationWebhook } from "@baseworks/db";
import { nanoid } from "nanoid";

/** The categories an endpoint may subscribe to (mirrors catalog Category). */
export const KNOWN_CATEGORIES = ["system", "team", "billing", "files", "security"] as const;

/** True if `value` is a non-empty array of known category strings. */
export function isValidCategories(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((c) => typeof c === "string" && (KNOWN_CATEGORIES as readonly string[]).includes(c))
  );
}

/** Generate an opaque signing secret. Shown to the tenant once, then never again. */
export function generateWebhookSecret(): string {
  return `whsec_${nanoid(32)}`;
}

/** Public projection of an endpoint row — the `secret` is never returned from reads.
 * Dates are emitted as ISO strings and the json `categories` column is typed so the
 * shape matches what the HTTP client actually receives over the wire (Eden infers
 * this return type for `App`). */
export function serializeWebhook(row: typeof notificationWebhook.$inferSelect) {
  const {
    secret: _secret,
    categories,
    status,
    lastStatus,
    lastDeliveryAt,
    createdAt,
    updatedAt,
    ...rest
  } = row;
  return {
    ...rest,
    status: status as "active" | "disabled" | "auto_disabled" | "admin_disabled",
    lastStatus: lastStatus as "success" | "failed" | null,
    categories: categories as string[] | null,
    lastDeliveryAt: lastDeliveryAt ? lastDeliveryAt.toISOString() : null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
