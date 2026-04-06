import { Type } from "@sinclair/typebox";
import { defineQuery, ok } from "@baseworks/shared";
import { examples } from "@baseworks/db";

export const ListExamplesInput = Type.Object({});

export const listExamples = defineQuery(ListExamplesInput, async (_input, ctx) => {
  // scopedDb.select auto-applies WHERE tenant_id = tenantId
  const results = await ctx.db.select(examples);

  return ok(results);
});
