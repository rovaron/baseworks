import { Type } from "@sinclair/typebox";
import { defineCommand, ok } from "@baseworks/shared";
import { usageRecords } from "../schema";

const RecordUsageInput = Type.Object({
  metric: Type.String(),
  quantity: Type.Number({ minimum: 1 }),
});

/**
 * Record a metered usage event for the current tenant.
 *
 * Inserts a usage record into the usage_records table with
 * `syncedToProvider = false`. The `billing:sync-usage` scheduled
 * job picks up unsynced records and reports them to the payment
 * provider.
 *
 * @param input - Usage data: metric (event name), quantity
 *   (positive integer)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<{ recorded, metric, quantity }> -- confirms
 *   the usage event was persisted
 *
 * Per D-07/D-11: Write-then-sync pattern for reliability.
 * Per T-03-16: Scoped to ctx.tenantId -- usage cannot be
 *   attributed to a different tenant.
 */
export const recordUsage = defineCommand(
  RecordUsageInput,
  async (input, ctx) => {
    await ctx.db.insert(usageRecords).values({
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      metric: input.metric,
      quantity: input.quantity,
      syncedToProvider: false,
    });

    return ok({
      recorded: true,
      metric: input.metric,
      quantity: input.quantity,
    });
  },
);
