import { Type } from "@sinclair/typebox";
import { defineCommand, ok } from "@baseworks/shared";
import { examples } from "@baseworks/db";

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
  // scopedDb.insert auto-injects tenantId -- no manual injection needed
  const [result] = await ctx.db
    .insert(examples)
    .values({
      title: input.title,
      description: input.description ?? null,
    });

  ctx.emit("example.created", { id: result.id, tenantId: ctx.tenantId });

  return ok(result);
});
