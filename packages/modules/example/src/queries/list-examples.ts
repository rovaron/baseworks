import { examples } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";

/** Default page size when the caller omits `limit`. */
const DEFAULT_LIMIT = 50;
/** Hard ceiling on rows returned per page, even if a larger `limit` is requested. */
const MAX_LIMIT = 100;

export const ListExamplesInput = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

/**
 * List example records for the current tenant (bounded page).
 *
 * Demonstrates the standard defineQuery pattern for new module
 * development. Uses the tenant-scoped database which auto-applies
 * tenant_id filtering. As the reference list-query template, it models a
 * bounded read: every request is clamped to `MAX_LIMIT` rows so copied
 * modules never ship an unbounded `SELECT *`.
 *
 * @param input - Pagination: optional `limit` (1..MAX_LIMIT, default
 *   DEFAULT_LIMIT) and `offset` (>= 0, default 0)
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<Example[]> -- one bounded page of example records for
 *   the tenant
 */
export const listExamples = defineQuery(ListExamplesInput, async (input, ctx) => {
  // Clamp the requested page size so a caller can never trigger an
  // unbounded scan, even by asking for a huge limit.
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = input.offset ?? 0;

  // Read through the request's RLS-scoped transaction. Postgres RLS confines
  // the result set to ctx.tenantId at the DB layer; we KEEP the explicit
  // tenant predicate as defense-in-depth (RLS is the backstop, not a
  // replacement). The query stays bounded by LIMIT/OFFSET.
  const results = await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(examples)
      .where(eq(examples.tenantId, ctx.tenantId))
      .limit(limit)
      .offset(offset),
  );

  return ok(results);
});
