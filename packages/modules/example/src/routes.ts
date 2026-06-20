import type { HandlerContext } from "@baseworks/shared";
import { Elysia } from "elysia";
import { CreateExampleInput, createExample } from "./commands/create-example";
import { listExamples } from "./queries/list-examples";

/**
 * Example module routes plugin.
 *
 * Demonstrates the standard route pattern for new modules with
 * CQRS dispatch. Mounted at /examples by the module registry.
 *
 * `handlerCtx` is produced by the tenant-scoped `.derive()` in apps/api
 * (see apps/api/src/index.ts). It is present at runtime on every request
 * that reaches this plugin, but it is invisible to Elysia's type inference
 * here because the derive lives in the parent app. The local `.derive()`
 * below re-exposes it with its real `HandlerContext` type so handlers can
 * read it without an `any` cast -- it is a typed passthrough, not a
 * recomputation, so the tenant-scoped instance is reused unchanged.
 */
export const exampleRoutes = new Elysia({ prefix: "/examples" })
  .derive((ctx) => ({
    handlerCtx: (ctx as unknown as { handlerCtx: HandlerContext }).handlerCtx,
  }))
  .post(
    "/",
    async ({ body, handlerCtx, set }) => {
      const result = await createExample(body, handlerCtx);
      if (!result.success) {
        set.status = 400;
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    },
    {
      // Reuse the command's TypeBox schema directly so route validation and
      // the CQRS command share one source of truth (Elysia accepts TSchema).
      body: CreateExampleInput,
    },
  )
  .get("/", async ({ handlerCtx, set }) => {
    const result = await listExamples({}, handlerCtx);
    if (!result.success) {
      set.status = 400;
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  });
