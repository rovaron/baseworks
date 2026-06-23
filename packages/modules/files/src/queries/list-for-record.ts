/**
 * Phase 27 / ATT-01 — list-files-for-record query.
 *
 * Returns the tenant's non-deleted files for one owner tuple
 * (ownerModule, ownerRecordType, recordId), each gated by the relation's
 * optional `canRead` hook. A failed `canRead` returns 404 — NOT 403 — so the
 * endpoint never leaks the existence of a record the caller may not view.
 * Tenant-scoping means a foreign-tenant record yields an empty list naturally;
 * the explicit 404 is the canRead existence-leak guard.
 *
 * Direct files-table access is allow-listed for this module (path-prefix exempt
 * in scripts/lint-no-direct-files-access.sh). Reads go through raw `db.execute`
 * (contract §5.3 / quota.ts precedent) rather than the `db.select().from(files)`
 * query builder, which the GritQL ban plugin flags repo-wide (it has no
 * path-allowlist primitive). DTOs carry only display metadata — NEVER storageKey
 * or bucket. To obtain a viewable URL the client calls `files:get-read-url`.
 */

import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { defineQuery, err, ok } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { sql } from "drizzle-orm";
import { findRelationByRecordType } from "../lib/relation-lookup";

const ListForRecordInput = Type.Object({
  ownerModule: Type.String({ minLength: 1 }),
  ownerRecordType: Type.String({ minLength: 1 }),
  recordId: Type.String({ minLength: 1 }),
});

type FileRow = {
  id: string;
  mime_type: string;
  byte_size: string | number;
  status: string;
  original_filename: string | null;
  transforms: unknown;
  created_at: Date;
};

export const listForRecord = defineQuery(ListForRecordInput, async (input, ctx) => {
  // 1. Optional read-permission gate → 404 (no existence leak; NOT 403).
  const relation = findRelationByRecordType(input.ownerModule, input.ownerRecordType);
  if (relation?.canRead) {
    const allowed = await relation.canRead(ctx, input.recordId);
    if (!allowed) return err("not_found");
  }

  // 2. Owner-scoped, tenant-scoped, live-rows-only read (uses files_owner_idx).
  //    NO storage_key / bucket in the projection — they must never leave the module.
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: files module scopes by ctx.tenantId manually (pre-ScopedDb pattern)
  const rows = (await db.execute(sql`
    SELECT id, mime_type, byte_size, status, original_filename, transforms, created_at
      FROM files
     WHERE tenant_id = ${ctx.tenantId}
       AND owner_module = ${input.ownerModule}
       AND owner_record_type = ${input.ownerRecordType}
       AND owner_record_id = ${input.recordId}
       AND deleted_at IS NULL
     ORDER BY created_at
  `)) as unknown as FileRow[];

  // 3. Map to DTOs. byte_size (bigint) comes back as a string via postgres.js;
  //    Number() is safe (file sizes are far below Number.MAX_SAFE_INTEGER).
  const dtos = rows.map((r) => ({
    fileId: r.id,
    mimeType: r.mime_type,
    byteSize: Number(r.byte_size),
    status: r.status,
    originalFilename: r.original_filename ?? null,
    transforms: r.transforms,
    createdAt: r.created_at,
  }));

  return ok({ files: dtos });
});
