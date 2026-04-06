import { Type } from "@sinclair/typebox";
import { defineQuery, ok } from "@baseworks/shared";
import { examples } from "@baseworks/db";
import { eq } from "drizzle-orm";

export const ListExamplesInput = Type.Object({});

export const listExamples = defineQuery(ListExamplesInput, async (_input, ctx) => {
  // TODO: Plan 03 wires tenant-scoped db wrapper. For now, filter manually.
  const results = await ctx.db.select().from(examples).where(eq(examples.tenantId, ctx.tenantId));

  return ok(results);
});
