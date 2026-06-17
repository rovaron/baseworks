/**
 * Phase 26 / UPL-01, MOD-02 — files module HTTP routes.
 * Phase 27 / UPL-02, UPL-04, ATT-01, ATT-02 — complete / read-url / delete / list.
 *
 * `filesRoutes` mounts the tenant-scoped file endpoints under /api/files. It
 * auto-mounts via getModuleRoutes() in apps/api's scoped band (AFTER
 * tenantMiddleware + the handlerCtx derive), so `ctx.handlerCtx` is guaranteed
 * present — no explicit .use() in apps/api (billing/routes.ts is the pattern).
 * Param routes read `ctx.params.fileId` (auth/routes.ts uses ctx.params.id).
 *
 * Error → HTTP status mapping is per-route (contract §1–§5). Common rules:
 *   not_found            → 404 (covers cross-tenant ids — no existence leak, R2)
 *   quota_exceeded /
 *     file_too_large     → 413
 *   forbidden            → 403 (attach canWrite gate only)
 *   every other code     → 400
 * NEVER expose storageKey/bucket/raw key in any response.
 */

import { Elysia, t } from "elysia";
import { attachFileCommand } from "./commands/attach-file";
import { completeUpload } from "./commands/complete-upload";
import { deleteFile } from "./commands/delete-file";
import { signUpload } from "./commands/sign-upload";
import { getReadUrl } from "./queries/get-read-url";
import { listForRecord } from "./queries/list-for-record";

/** Map a complete-upload error code to an HTTP status (contract §1). */
function mapComplete(code: string): number {
  if (code === "not_found") return 404;
  if (code === "file_too_large") return 413;
  // mime_mismatch | mime_unverifiable | object_not_found | unknown_relation → 400
  return 400;
}

export const filesRoutes = new Elysia({ prefix: "/api/files" })
  .post(
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
  )
  // UPL-02 — server-authoritative finalize. No request body; fileId from path.
  .post("/:fileId/complete", async (ctx: any) => {
    const r = await completeUpload({ fileId: ctx.params.fileId }, ctx.handlerCtx);
    if (!r.success) {
      ctx.set.status = mapComplete(r.error);
      return { error: r.error };
    }
    return r.data;
  })
  // UPL-04 — short-lived signed READ url. Body carries only url + expiresAt.
  .get("/:fileId/read-url", async (ctx: any) => {
    const r = await getReadUrl({ fileId: ctx.params.fileId }, ctx.handlerCtx);
    if (!r.success) {
      ctx.set.status = r.error === "not_found" ? 404 : 400;
      return { error: r.error };
    }
    return r.data;
  })
  // ATT-02 — link a signed file to a concrete owner record. canWrite gate → 403.
  .post(
    "/attach",
    async (ctx: any) => {
      const r = await attachFileCommand(ctx.body, ctx.handlerCtx);
      if (!r.success) {
        ctx.set.status = r.error === "not_found" ? 404 : r.error === "forbidden" ? 403 : 400;
        return { error: r.error };
      }
      return r.data;
    },
    {
      body: t.Object({
        fileId: t.String({ minLength: 1 }),
        ownerModule: t.String({ minLength: 1 }),
        ownerRecordType: t.String({ minLength: 1 }),
        ownerRecordId: t.String({ minLength: 1 }),
      }),
    },
  )
  // ATT-01 — list a record's non-deleted files. canRead denial → 404 (no leak).
  .get(
    "/list-for-record",
    async (ctx: any) => {
      const r = await listForRecord(ctx.query, ctx.handlerCtx);
      if (!r.success) {
        ctx.set.status = r.error === "not_found" ? 404 : 400;
        return { error: r.error };
      }
      return r.data;
    },
    {
      query: t.Object({
        ownerModule: t.String({ minLength: 1 }),
        ownerRecordType: t.String({ minLength: 1 }),
        recordId: t.String({ minLength: 1 }),
      }),
    },
  )
  // UPL-04 — tenant-scoped SOFT delete. Cross-tenant id → 404 (no leak).
  .delete("/:fileId", async (ctx: any) => {
    const r = await deleteFile({ fileId: ctx.params.fileId }, ctx.handlerCtx);
    if (!r.success) {
      ctx.set.status = r.error === "not_found" ? 404 : 400;
      return { error: r.error };
    }
    return r.data;
  });
