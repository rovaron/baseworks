/**
 * Phase 27 / UPL-04 — get-read-url: mint a short-lived signed READ url.
 *
 * GET /api/files/:fileId/read-url. Loads the row tenant-scoped, enforces the
 * relation's optional `canRead` hook, and returns a `signRead` envelope whose
 * TTL comes from `env.STORAGE_SIGNED_URL_TTL_SEC` (5–15 min). The raw
 * storage_key/bucket NEVER appear in the response — only `url` + `expiresAt`
 * (the Verify phase scans every /api/files/* body for the key prefix).
 *
 * A missing row, a foreign-tenant id, OR a `canRead` denial all return
 * `not_found` → 404. The `canRead` denial is deliberately 404, NOT 403: a 403
 * would leak that the file exists (existence-leak guard, R2).
 *
 * The load uses raw `db.execute(sql)` (not the banned `db.select().from(files)`
 * builder — see complete-upload.ts header / no-direct-files-table-access).
 */

import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { defineQuery, err, ok } from "@baseworks/shared";
import { getFileStorage } from "@baseworks/storage";
import { Type } from "@sinclair/typebox";
import { sql } from "drizzle-orm";
import { dispositionFor, findRelationByRecordType } from "../lib/relation-lookup";

const GetReadUrlInput = Type.Object({
  fileId: Type.String({ minLength: 1 }),
});

export const getReadUrl = defineQuery(GetReadUrlInput, async (input, ctx) => {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: files module scopes by ctx.tenantId manually (pre-ScopedDb pattern)

  // 1. Load tenant-scoped, non-deleted. Foreign id → 0 rows → 404 (R2).
  const rows = (await db.execute(sql`
    SELECT owner_module, owner_record_type, owner_record_id, bucket, storage_key, mime_type, original_filename
      FROM files
     WHERE id = ${input.fileId}
       AND tenant_id = ${ctx.tenantId}
       AND deleted_at IS NULL
     LIMIT 1
  `)) as any[];
  const row = rows[0];
  if (!row) return err("not_found");

  // 2. Relation `canRead` gate. Denial → 404 (no existence leak), never 403.
  const relation = findRelationByRecordType(row.owner_module, row.owner_record_type);
  if (relation?.canRead) {
    const allowed = await relation.canRead(ctx, row.owner_record_id);
    if (!allowed) return err("not_found");
  }

  // 3. Sign a READ url with the operator-configured TTL. signRead never returns
  //    the raw key.
  const signed = await getFileStorage().signRead({
    bucket: row.bucket,
    key: row.storage_key,
    expiresInSec: env.STORAGE_SIGNED_URL_TTL_SEC,
    responseContentDisposition: dispositionFor({
      mimeType: row.mime_type,
      originalFilename: row.original_filename,
    }),
  });

  // No storageKey / bucket — only the url + expiry.
  return ok({ url: signed.url, expiresAt: signed.expiresAt });
});
