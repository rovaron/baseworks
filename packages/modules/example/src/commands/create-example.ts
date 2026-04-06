import { Type } from "@sinclair/typebox";
import { defineCommand, ok } from "@baseworks/shared";
import { examples } from "@baseworks/db";

export const CreateExampleInput = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

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
