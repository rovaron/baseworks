import { Elysia, t } from "elysia";
import { createExample } from "./commands/create-example";
import { listExamples } from "./queries/list-examples";

/**
 * Example module routes plugin.
 *
 * Demonstrates the standard route pattern for new modules with
 * CQRS dispatch. Mounted at /examples by the module registry.
 * Uses handlerCtx from the tenant middleware derive chain.
 */
export const exampleRoutes = new Elysia({ prefix: "/examples" })
  .post(
    "/",
    async (ctx: any) => {
      const result = await createExample(ctx.body, ctx.handlerCtx);
      if (!result.success) {
        ctx.set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
      }),
    },
  )
  .get("/", async (ctx: any) => {
    const result = await listExamples({}, ctx.handlerCtx);
    if (!result.success) {
      ctx.set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  });
