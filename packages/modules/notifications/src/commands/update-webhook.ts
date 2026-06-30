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
 *
 * An endpoint a platform admin has force-disabled (status `admin_disabled`) is
 * locked: tenants cannot edit or re-enable it — only a platform admin can lift
 * the lock (see adminReenableWebhook).
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

  const where = and(
    eq(notificationWebhook.id, input.id),
    eq(notificationWebhook.tenantId, ctx.tenantId),
  );

  // Read-then-write in one tenant-scoped transaction so the admin-lock check is
  // atomic with the update (a tenant can't race past a concurrent force-disable).
  const result = await requireWithTenant(ctx)(async (tx) => {
    const [current] = (await tx
      .select({ status: notificationWebhook.status })
      .from(notificationWebhook)
      .where(where)
      .limit(1)) as { status: string }[];
    if (!current) return { kind: "not_found" as const };
    if (current.status === "admin_disabled") return { kind: "locked" as const };
    const [row] = (await tx
      .update(notificationWebhook)
      .set(patch)
      .where(where)
      .returning()) as (typeof notificationWebhook.$inferSelect)[];
    return { kind: "ok" as const, row };
  });

  if (result.kind === "not_found") return err("WEBHOOK_NOT_FOUND");
  if (result.kind === "locked") return err("WEBHOOK_ADMIN_LOCKED");
  return ok(serializeWebhook(result.row));
});
