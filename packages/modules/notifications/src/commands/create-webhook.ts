// packages/modules/notifications/src/commands/create-webhook.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
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
  const [row] = (await requireWithTenant(ctx)((tx) =>
    tx
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
      .returning(),
  )) as (typeof notificationWebhook.$inferSelect)[];
  // Return the secret exactly once, alongside the public projection.
  return ok({ ...serializeWebhook(row), secret });
});
