/**
 * Phase 26 / UPL-01, MOD-02 — files module HTTP routes.
 *
 * `filesRoutes` mounts the tenant-scoped sign-upload endpoint under /api/files.
 * It auto-mounts via getModuleRoutes() in apps/api's scoped band (AFTER
 * tenantMiddleware + the handlerCtx derive), so `ctx.handlerCtx` is guaranteed
 * present — no explicit .use() in apps/api (billing/routes.ts is the pattern).
 *
 * Error → HTTP status mapping (contract §3.2):
 *   quota_exceeded → 413 (QUO-02); every other error code → 400.
 */

import { Elysia, t } from "elysia";
import { signUpload } from "./commands/sign-upload";

export const filesRoutes = new Elysia({ prefix: "/api/files" }).post(
  "/sign-upload",
  async (ctx: any) => {
    const r = await signUpload(ctx.body, ctx.handlerCtx);
    if (!r.success) {
      ctx.set.status = r.error === "quota_exceeded" ? 413 : 400;
      return { error: r.error };
    }
    return r.data;
  },
  {
    body: t.Object({
      ownerModule: t.String({ minLength: 1 }),
      kind: t.String({ minLength: 1 }),
      mimeType: t.String({ minLength: 1 }),
      byteSize: t.Integer({ minimum: 1 }),
    }),
  },
);
