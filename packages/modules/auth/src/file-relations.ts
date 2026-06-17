/**
 * Phase 29 / IDA-01, IDA-02 — auth module file-relation specs + permission hooks.
 *
 * Declarative bodies for `ModuleDefinition.fileRelations` (kept out of index.ts so
 * the manifest stays thin). Two single-cardinality image relations:
 *   - `user` (avatar): owner-only read/write.
 *   - `organization` (logo): any tenant member reads; owner/admin writes.
 *
 * SVG is excluded from every allow-list (D-6): sign-upload's MIME check rejects it
 * at sign-time → `mime_not_allowed` → HTTP 400. Defense in depth: ImageVariantSpec
 * has no svg format, magic-bytes can't verify svg, and dispositionFor forces
 * attachment for svg.
 *
 * CROSS-MODULE RULE (Phase 26 SC#5 / Phase 29): this file MUST NOT import
 * `@baseworks/module-files`. The role check reads auth's OWN `member` table
 * directly (allowed — a module may read its own schema), never the files module.
 */

import { env } from "@baseworks/config";
import { getDb, member } from "@baseworks/db";
import type { FileRelation, HandlerContext } from "@baseworks/shared";
import { and, eq } from "drizzle-orm";

/** Per-file caps (5 MiB each). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** Image MIME allow-list shared by both relations — SVG intentionally excluded (D-6). */
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Tenant-scoped owner/admin check against auth's own `member` table. Reads the
 * caller's role for (ctx.tenantId, ctx.userId); true when role ∈ {owner,admin}.
 * No files-module import — auth reads its own table directly.
 */
export async function isOwnerOrAdmin(ctx: HandlerContext): Promise<boolean> {
  if (!ctx.userId || !ctx.tenantId) return false;
  const db = getDb(env.DATABASE_URL);
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, ctx.tenantId), eq(member.userId, ctx.userId)))
    .limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin";
}

/** `auth:user` — the user's avatar. Owner-only, single, 4 webp variants. */
export const userFileRelation: FileRelation = {
  recordType: "user",
  allowedMimeTypes: IMAGE_MIME_TYPES,
  maxByteSize: AVATAR_MAX_BYTES,
  cardinality: "single",
  generateVariants: [
    { name: "avatar-64", width: 64, format: "webp", quality: 82 },
    { name: "avatar-128", width: 128, format: "webp", quality: 82 },
    { name: "avatar-256", width: 256, format: "webp", quality: 82 },
    { name: "avatar-512", width: 512, format: "webp", quality: 82 },
  ],
  onDelete: "cascade",
  canRead: async (ctx, recordId) => recordId === ctx.userId,
  canWrite: async (ctx, recordId) => recordId === ctx.userId,
};

/** `auth:organization` — the tenant's logo. Member-read, owner/admin-write, single. */
export const organizationFileRelation: FileRelation = {
  recordType: "organization",
  allowedMimeTypes: IMAGE_MIME_TYPES,
  maxByteSize: LOGO_MAX_BYTES,
  cardinality: "single",
  generateVariants: [
    { name: "logo-128", width: 128, format: "webp", quality: 85 },
    { name: "logo-256", width: 256, format: "webp", quality: 85 },
  ],
  onDelete: "cascade",
  // Any member of the active tenant may READ; owner/admin may WRITE.
  canRead: async (ctx, recordId) => recordId === ctx.tenantId,
  canWrite: async (ctx, recordId) => recordId === ctx.tenantId && (await isOwnerOrAdmin(ctx)),
};
