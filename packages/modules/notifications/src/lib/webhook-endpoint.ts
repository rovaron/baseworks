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

/** Public projection of an endpoint row — the `secret` is never returned from reads. */
export function serializeWebhook(row: typeof notificationWebhook.$inferSelect) {
  const { secret: _secret, ...rest } = row;
  return rest;
}
