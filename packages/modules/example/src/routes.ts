import { Elysia, t } from "elysia";
import { createExample } from "./commands/create-example";
import { listExamples } from "./queries/list-examples";

/**
 * Example module routes. Mounted at /examples by the module registry.
 * Uses handlerCtx from tenant middleware derive chain.
 */
export const exampleRoutes = new Elysia({ prefix: "/examples" })
  .post(
    "/",
    async ({ handlerCtx, body }: any) => {
      return createExample(body, handlerCtx);
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
      }),
    },
  )
  .get("/", async ({ handlerCtx }: any) => {
    return listExamples({}, handlerCtx);
  });
