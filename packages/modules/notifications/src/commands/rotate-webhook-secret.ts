// packages/modules/notifications/src/commands/rotate-webhook-secret.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { generateWebhookSecret } from "../lib/webhook-endpoint";

const Input = Type.Object({ id: Type.String() });

/**
 * Issue a new signing secret for an endpoint and return it once. An endpoint a
 * platform admin has force-disabled (`admin_disabled`) is locked — a tenant
 * cannot rotate its secret (locked endpoints are read-only to the tenant).
 */
export const rotateWebhookSecret = defineCommand(Input, async (input, ctx) => {
  const secret = generateWebhookSecret();
  const where = and(
    eq(notificationWebhook.id, input.id),
    eq(notificationWebhook.tenantId, ctx.tenantId),
  );
  const result = await requireWithTenant(ctx)(async (tx) => {
    const [current] = (await tx
      .select({ status: notificationWebhook.status })
      .from(notificationWebhook)
      .where(where)
      .limit(1)) as { status: string }[];
    if (!current) return { kind: "not_found" as const };
    if (current.status === "admin_disabled") return { kind: "locked" as const };
    await tx.update(notificationWebhook).set({ secret }).where(where);
    return { kind: "ok" as const };
  });
  if (result.kind === "not_found") return err("WEBHOOK_NOT_FOUND");
  if (result.kind === "locked") return err("WEBHOOK_ADMIN_LOCKED");
  return ok({ id: input.id, secret });
});
