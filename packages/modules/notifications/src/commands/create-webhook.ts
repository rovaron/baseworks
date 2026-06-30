// packages/modules/notifications/src/commands/create-webhook.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import {
  generateWebhookSecret,
  isValidCategories,
  serializeWebhook,
} from "../lib/webhook-endpoint";
import { assertSafeWebhookUrl } from "../lib/webhook-security";

const Input = Type.Object({
  url: Type.String({ minLength: 1 }),
  categories: Type.Array(Type.String()),
  description: Type.Optional(Type.String()),
});

/**
 * Register a webhook endpoint. Validates the URL through the SSRF guard,
 * generates a signing secret, and returns the created row WITH the secret —
 * the only time it is ever exposed.
 */
export const createWebhook = defineCommand(Input, async (input, ctx) => {
  if (!isValidCategories(input.categories)) {
    return err("INVALID_CATEGORIES");
  }
  try {
    await assertSafeWebhookUrl(input.url);
  } catch (e) {
    return err(e instanceof Error ? e.message : "INVALID_WEBHOOK_URL");
  }

  const secret = generateWebhookSecret();
  // Refuse to re-register a destination a platform admin has force-disabled —
  // otherwise a tenant could recreate an active endpoint to the same URL and
  // undo the lock. (Done in-tx so it's atomic with the insert.)
  const result = await requireWithTenant(ctx)(async (tx) => {
    const [locked] = (await tx
      .select({ id: notificationWebhook.id })
      .from(notificationWebhook)
      .where(
        and(
          eq(notificationWebhook.tenantId, ctx.tenantId),
          eq(notificationWebhook.url, input.url),
          eq(notificationWebhook.status, "admin_disabled"),
        ),
      )
      .limit(1)) as { id: string }[];
    if (locked) return { kind: "locked" as const };
    const [row] = (await tx
      .insert(notificationWebhook)
      .values({
        tenantId: ctx.tenantId,
        url: input.url,
        secret,
        categories: input.categories,
        description: input.description ?? null,
        status: "active",
        // biome-ignore lint/suspicious/noExplicitAny: insert shape narrowed by schema
      } as any)
      .returning()) as (typeof notificationWebhook.$inferSelect)[];
    return { kind: "ok" as const, row };
  });
  if (result.kind === "locked") return err("WEBHOOK_ADMIN_LOCKED");
  // Return the secret exactly once, alongside the public projection.
  return ok({ ...serializeWebhook(result.row), secret });
});
