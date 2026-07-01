// packages/modules/notifications/src/commands/set-preferences.ts
import { notificationPreference } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import type { Category } from "../categories";
import { getCategory } from "../categories";
import { PREFERENCE_CHANNELS } from "../lib/preferences";

const Input = Type.Object({
  preferences: Type.Array(
    Type.Object({
      category: Type.String(),
      channel: Type.String(),
      enabled: Type.Boolean(),
    }),
  ),
});

/**
 * Upsert the current user's notification preferences. Validates every entry
 * up-front (fail-loud): the category must be registered, the channel must be
 * wired, and a `mutable: false` category (e.g. security) cannot be muted. All
 * rows are written under one RLS-scoped transaction, keyed to `ctx.userId`.
 */
export const setPreferences = defineCommand(Input, async (input, ctx) => {
  for (const p of input.preferences) {
    const def = getCategory(p.category as Category);
    if (!def) return err("UNKNOWN_CATEGORY");
    if (!(PREFERENCE_CHANNELS as readonly string[]).includes(p.channel)) {
      return err("UNKNOWN_CHANNEL");
    }
    if (!def.mutable && p.enabled === false) return err("CATEGORY_NOT_MUTABLE");
  }

  await requireWithTenant(ctx)(async (tx) => {
    for (const p of input.preferences) {
      await tx
        .insert(notificationPreference)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId as string,
          category: p.category,
          channel: p.channel,
          enabled: p.enabled,
          // biome-ignore lint/suspicious/noExplicitAny: insert shape narrowed by schema
        } as any)
        .onConflictDoUpdate({
          target: [
            notificationPreference.tenantId,
            notificationPreference.userId,
            notificationPreference.category,
            notificationPreference.channel,
          ],
          set: { enabled: p.enabled, updatedAt: new Date() },
        });
    }
  });

  return ok({ updated: input.preferences.length });
});
