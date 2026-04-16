import { Type } from "@sinclair/typebox";
import { defineQuery, ok } from "@baseworks/shared";
import { examples } from "@baseworks/db";

export const ListExamplesInput = Type.Object({});

/**
 * List all example records for the current tenant.
 *
 * Demonstrates the standard defineQuery pattern for new module
 * development. Uses the tenant-scoped database which auto-applies
 * tenant_id filtering.
 *
 * @param input - Empty object (no additional input required)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<Example[]> -- all example records for the
 *   tenant
 */
export const listExamples = defineQuery(ListExamplesInput, async (_input, ctx) => {
  // scopedDb.select auto-applies WHERE tenant_id = tenantId
  const results = await ctx.db.select(examples);

  return ok(results);
});
