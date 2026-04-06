import { Elysia, t } from "elysia";
import { createExample } from "./commands/create-example";
import { listExamples } from "./queries/list-examples";
import type { HandlerContext } from "@baseworks/shared";

/**
 * Example module routes. Mounted at /examples by the module registry.
 */
export const exampleRoutes = new Elysia({ prefix: "/examples" })
  .post(
    "/",
    async ({ body, store }) => {
      // TODO: Plan 03 wires real tenant context from session middleware
      const ctx: HandlerContext = {
        tenantId: (store as any).tenantId ?? "dev-tenant",
        db: (store as any).db,
        emit: (store as any).emit ?? (() => {}),
      };
      return createExample(body, ctx);
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
      }),
    },
  )
  .get("/", async ({ store }) => {
    // TODO: Plan 03 wires real tenant context from session middleware
    const ctx: HandlerContext = {
      tenantId: (store as any).tenantId ?? "dev-tenant",
      db: (store as any).db,
      emit: (store as any).emit ?? (() => {}),
    };
    return listExamples({}, ctx);
  });
