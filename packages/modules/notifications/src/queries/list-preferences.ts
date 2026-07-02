// packages/modules/notifications/src/queries/list-preferences.ts
import { notificationPreference } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { getCategories } from "../categories";

const Input = Type.Object({});

/**
 * The current user's effective email preferences: every registered category
 * with its label + mutable flag, overlaid with the user's stored opt-outs
 * (absent row = enabled). Driven entirely by the category registry, so the UI
 * hardcodes no category list.
 */
export const listPreferences = defineQuery(Input, async (_input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.userId, ctx.userId as string),
          eq(notificationPreference.channel, "email"),
        ),
      ),
  )) as (typeof notificationPreference.$inferSelect)[];

  const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.category));

  const preferences = getCategories().map((c) => ({
    category: c.key,
    label: c.label,
    // Non-mutable categories are always delivered (notify() bypasses the gate for
    // them), so report email ON regardless of any stored row — keeps the displayed
    // state honest with delivery behavior even if a stale opt-out row exists.
    email: c.mutable ? !disabled.has(c.key) : true,
    mutable: c.mutable,
  }));

  return ok({ preferences });
});
