// packages/modules/notifications/src/commands/update-webhook.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { isValidCategories, serializeWebhook } from "../lib/webhook-endpoint";
import { assertSafeWebhookUrl } from "../lib/webhook-security";

const Input = Type.Object({
  id: Type.String(),
  url: Type.Optional(Type.String({ minLength: 1 })),
  categories: Type.Optional(Type.Array(Type.String())),
  description: Type.Optional(Type.String()),
  // Tenants may activate or disable; auto_disabled is system-only.
  status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("disabled")])),
});

/**
 * Edit an endpoint. Re-validates a changed URL through the SSRF guard.
 * Re-enabling (status → active) also clears any auto-disable lockout by
 * resetting consecutiveFailures.
 */
export const updateWebhook = defineCommand(Input, async (input, ctx) => {
  if (input.categories !== undefined && !isValidCategories(input.categories)) {
    return err("INVALID_CATEGORIES");
  }
  if (input.url !== undefined) {
    try {
      await assertSafeWebhookUrl(input.url);
    } catch (e) {
      return err(e instanceof Error ? e.message : "INVALID_WEBHOOK_URL");
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: partial column patch
  const patch: any = {};
  if (input.url !== undefined) patch.url = input.url;
  if (input.categories !== undefined) patch.categories = input.categories;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "active") {
      patch.consecutiveFailures = "0";
      patch.disabledReason = null;
    }
  }
  if (Object.keys(patch).length === 0) return err("NO_FIELDS_TO_UPDATE");

  const updated = (await requireWithTenant(ctx)((tx) =>
    tx
      .update(notificationWebhook)
      .set(patch)
      .where(
        and(eq(notificationWebhook.id, input.id), eq(notificationWebhook.tenantId, ctx.tenantId)),
      )
      .returning(),
  )) as (typeof notificationWebhook.$inferSelect)[];
  if (updated.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok(serializeWebhook(updated[0]));
});
