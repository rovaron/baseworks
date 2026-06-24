import { examples } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";

export const CreateExampleInput = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

/**
 * Create a new example record for the current tenant.
 *
 * Demonstrates the standard defineCommand pattern for new module
 * development. Inserts a record via the tenant-scoped database
 * and emits an `example.created` domain event.
 *
 * @param input - Example data: title (min 1 char), optional
 *   description
 * @param ctx   - Handler context: tenantId, userId, db, emit
 * @returns Result<Example> -- the created example record
 */
export const createExample = defineCommand(CreateExampleInput, async (input, ctx) => {
  // Run the insert through the request's RLS-scoped transaction. Postgres RLS
  // confines the write to ctx.tenantId; we still stamp tenantId explicitly so
  // the row carries the right tenant and the WITH CHECK policy is satisfied
  // (defense-in-depth, not a replacement for the policy).
  const inserted = (await requireWithTenant(ctx)(
    (tx) =>
      tx
        .insert(examples)
        .values({
          tenantId: ctx.tenantId,
          title: input.title,
          description: input.description ?? null,
        })
        .returning(),
    // biome-ignore lint/suspicious/noExplicitAny: raw-tx returning() is untyped (tx is any); matches the prior scopedDb return shape
  )) as any[];
  const [result] = inserted;

  ctx.emit("example.created", { id: result.id, tenantId: ctx.tenantId });

  return ok(result);
});
