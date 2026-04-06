import { Type } from "@sinclair/typebox";
import { defineCommand, ok } from "@baseworks/shared";
import { examples } from "@baseworks/db";

export const CreateExampleInput = Type.Object({
  title: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

export const createExample = defineCommand(CreateExampleInput, async (input, ctx) => {
  const [result] = await ctx.db
    .insert(examples)
    .values({
      tenantId: ctx.tenantId,
      title: input.title,
      description: input.description ?? null,
    })
    .returning();

  ctx.emit("example.created", { id: result.id, tenantId: ctx.tenantId });

  return ok(result);
});
