/**
 * Phase 27 / ATT-02 — attach-file command + ergonomic helper.
 *
 * Links a previously-signed `files` row (minted by sign-upload with an empty
 * ownerRecordId) to a concrete owner record. The row is recovered tenant-scoped,
 * its owner relation is re-asserted against the caller's claim, an optional
 * per-relation `canWrite` hook gates the link, and `owner_record_id` is set.
 *
 * Cross-module invocation WITHOUT an import (Phase 26 SC#5 / Phase 29 ban):
 * other modules call this command through `ctx.dispatch("files:attach-file", …)`
 * — a string through the CQRS bus, never an `@baseworks/module-files` import.
 * The `attachFile(ctx, args)` helper below prefers that bus path and falls back
 * to a direct command call only in bare-ctx tests.
 *
 * Direct files-table access is allow-listed for this module (path-prefix exempt
 * in scripts/lint-no-direct-files-access.sh); every statement carries an explicit
 * tenant_id predicate. NEVER expose storageKey/bucket in the response.
 */

import { env } from "@baseworks/config";
import { files, getDb } from "@baseworks/db";
import type { HandlerContext, Result } from "@baseworks/shared";
import { defineCommand, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq, sql } from "drizzle-orm";
import { findRelationByRecordType } from "../lib/relation-lookup";

const AttachFileInput = Type.Object({
  fileId: Type.String({ minLength: 1 }),
  ownerModule: Type.String({ minLength: 1 }),
  ownerRecordType: Type.String({ minLength: 1 }),
  ownerRecordId: Type.String({ minLength: 1 }),
});

type AttachFileArgs = {
  fileId: string;
  ownerModule: string;
  ownerRecordType: string;
  ownerRecordId: string;
};

type AttachFileResult = { fileId: string; ownerRecordId: string };

/**
 * `files:attach-file` — set a pending/uploaded row's ownerRecordId.
 *
 * State machine (contract §5.2):
 *   1. Load row tenant-scoped (id + tenantId, deleted_at IS NULL). None → 404
 *      (a cross-tenant id returns 0 rows → 404, no existence leak).
 *   2. Consistency: row.ownerModule/ownerRecordType must equal the caller's claim
 *      (the file was minted for a specific relation at sign-time) → relation_mismatch.
 *   3. Optional relation.canWrite gate → forbidden (403). Tenant scope already
 *      proved file ownership; this gates linking to a record the caller may not own.
 *   4. UPDATE owner_record_id (allowed while pending — attach may precede complete).
 */
export const attachFileCommand = defineCommand(AttachFileInput, async (input, ctx) => {
  const db = getDb(env.DATABASE_URL);

  // 1. Load row tenant-scoped — foreign id ⇒ 0 rows ⇒ 404 (no existence leak).
  //    Raw read (contract §5.2 / quota.ts precedent): the `db.select().from(files)`
  //    builder is flagged repo-wide by the GritQL ban (no path-allowlist primitive).
  const loaded = (await db.execute(sql`
    SELECT owner_module, owner_record_type
      FROM files
     WHERE id = ${input.fileId}
       AND tenant_id = ${ctx.tenantId}
       AND deleted_at IS NULL
     LIMIT 1
  `)) as unknown as Array<{ owner_module: string; owner_record_type: string }>;
  const row = loaded[0];
  if (!row) return err("not_found");

  // 2. Consistency — the row must belong to the relation the caller names.
  if (row.owner_module !== input.ownerModule || row.owner_record_type !== input.ownerRecordType) {
    return err("relation_mismatch");
  }

  // 3. Optional write-permission gate → 403.
  const relation = findRelationByRecordType(input.ownerModule, input.ownerRecordType);
  if (relation?.canWrite) {
    const allowed = await relation.canWrite(ctx, input.ownerRecordId);
    if (!allowed) return err("forbidden");
  }

  // 4. Link the row (updatedAt auto-bumps via $onUpdate). Tenant-scoped.
  await db
    .update(files)
    .set({ ownerRecordId: input.ownerRecordId })
    .where(and(eq(files.id, input.fileId), eq(files.tenantId, ctx.tenantId)));

  return ok<AttachFileResult>({ fileId: input.fileId, ownerRecordId: input.ownerRecordId });
});

/**
 * Ergonomic server-side helper (contract §5.2). Prefers the sanctioned bus path
 * `ctx.dispatch("files:attach-file", args)` when present (production / nested
 * dispatch), falling back to a direct command call for bare-ctx tests.
 *
 * Cross-module callers (auth, Phase 29) MUST use `ctx.dispatch(...)` directly and
 * never import this helper — importing it would reintroduce the module coupling
 * the dispatch channel exists to avoid.
 */
export async function attachFile(
  ctx: HandlerContext,
  args: AttachFileArgs,
): Promise<Result<AttachFileResult>> {
  if (ctx.dispatch) {
    return ctx.dispatch("files:attach-file", args) as Promise<Result<AttachFileResult>>;
  }
  return attachFileCommand(args, ctx);
}
