/**
 * Phase 26 / MOD-02 — files module definition.
 * Phase 27 / UPL-02, UPL-04, ATT-01, ATT-02, MOD-03 — complete/read/delete/attach.
 *
 * The end-to-end file flow: operator-configurable per-tenant quota enforced
 * atomically at sign-time, server-authoritative completion (size + magic-byte
 * verification), signed read URLs, soft-delete with quota refund, generic
 * record attachment, and a cascade soft-delete subscriber. Follows the
 * Medusa-style module pattern (billing is the structural analog).
 *
 * Phase 28 / IMG-01, IMG-02, IMG-03 — async image-variant generation.
 *
 * Routes:   /api/files/sign-upload, /:fileId/complete, /:fileId/read-url,
 *           /attach, /list-for-record, DELETE /:fileId
 * Commands: files:sign-upload, files:complete-upload, files:attach-file,
 *           files:delete-file
 * Queries:  files:get-read-url, files:list-for-record
 * Jobs:     files:transform-image (queue: image-transform, concurrency: 2)
 * Events:   file.signed, file.completed, file.deleted, file.transformed,
 *           file.transform-failed
 */

// Phase 31 — env + getDb power adminAttachmentRelation.ownerExists (tenant
// existence) and the orphan reaper's resolver dispatch.
import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import type { FileRelation, ModuleDefinition } from "@baseworks/shared";
import { sql } from "drizzle-orm";
import { attachFileCommand } from "./commands/attach-file";
import { completeUpload } from "./commands/complete-upload";
import { deleteFile } from "./commands/delete-file";
import { signUpload } from "./commands/sign-upload";
import { storageHealthContributor } from "./health/storage-health";
import { reapOrphanFiles } from "./jobs/reap-orphan-files";
import { reapPendingUploads } from "./jobs/reap-pending-uploads";
import { reapSoftDeleted } from "./jobs/reap-soft-deleted";
import { reconcileTenantUsage } from "./jobs/reconcile-tenant-usage";
import { transformImage } from "./jobs/transform-image";
import { getReadUrl } from "./queries/get-read-url";
import { listForRecord } from "./queries/list-for-record";
import { filesRoutes } from "./routes";

// Phase 30 / UI-02 — cross-tenant admin files operations. The host (apps/api
// admin route plugin, behind requirePlatformAdmin()) imports these directly and
// supplies the gated `:id` path param as the target tenant. They are NOT mounted
// on the public ctx-scoped routes.
export {
  type AdminFileDto,
  adminCompleteUpload,
  adminDeleteFile,
  adminGetReadUrl,
  adminListFilesForTenant,
  adminSignUpload,
} from "./commands/admin-files";
// Ergonomic server-side helper (contract §5.2). Cross-module callers use
// ctx.dispatch("files:attach-file", …) instead — never this import.
export { attachFile } from "./commands/attach-file";
// Phase 30 / UI-02 — shared gated image-transform enqueue (public subscriber +
// admin complete path).
export { enqueueTransform, registerFilesHooks } from "./hooks/on-tenant-created";
export { transformImage } from "./jobs/transform-image";
// Phase 31 / OPS-02 — worker binds this to its registry event bus so the orphan
// reaper's `file.deleted` events are emitted + traced (best-effort; the DB
// tombstone is authoritative).
export { setCleanupEventSink } from "./lib/cleanup-events";
// Phase 28 / IMG-01 — worker binds this to its registry event bus so the
// image-transform job's lifecycle events are emitted + traced.
export { setTransformEventSink } from "./lib/transform-events";
// Re-exported so apps/api can static-chain the plugin with its precise Elysia
// type (Eden Treaty end-to-end typing).
export { filesRoutes } from "./routes";

/**
 * Phase 30 / UI-02 — generic `admin-attachment` file relation.
 *
 * Owned by the files module (the module whose admin functions consume it), so the
 * existing boot-time `collectFileRelations` walk registers it as
 * `(ownerModule="files", kind="admin-attachment")` with no apps/api boot change.
 *
 * `canRead`/`canWrite` return `false` as defense-in-depth: the relation is
 * globally registered, so a non-admin could in theory `POST /api/files/sign-upload
 * {ownerModule:"files",kind:"admin-attachment"}` in their OWN tenant — but the
 * public read + attach paths consult these hooks and DENY (the worst case is an
 * orphan pending row in their own tenant/quota, swept by Phase 31). The admin
 * functions bypass hooks and never call attach, so they are unaffected. SVG +
 * GIF are excluded (SVG: XSS/SSRF; GIF: keep transforms on the proven sharp
 * raster path); PDF is allowed but won't match the image gate ⇒ no transform.
 */
const adminAttachmentRelation: FileRelation = {
  recordType: "tenant",
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  maxByteSize: 10 * 1024 * 1024,
  generateVariants: [{ name: "thumb-256", width: 256, format: "webp" }],
  cardinality: "many",
  onDelete: "orphan",
  canRead: async () => false,
  canWrite: async () => false,
  // Phase 31 / OPS-02 — orphan-reaper owner-existence. recordId === tenantId
  // (admin attachments are owned by the tenant), so existence === the tenant's
  // organization row existing. Reads the shared `organization` table (allowed:
  // only the files TABLE + cross-module package imports are banned). Returns a
  // definitive boolean from a successful query; the reaper treats a thrown query
  // as "unknown" ⇒ SKIP.
  ownerExists: async ({ recordId }) => {
    const db = getDb(env.DATABASE_URL);
    const rows = (await db.execute(
      sql`SELECT 1 FROM organization WHERE id = ${recordId} LIMIT 1`,
    )) as unknown as unknown[];
    return rows.length > 0;
  },
};

export default {
  name: "files",
  routes: filesRoutes,
  // Phase 30 / UI-02 — collected into fileRelationsRegistry at registry.loadAll()
  // so adminSignUpload's relation lookup (files:admin-attachment) resolves.
  fileRelations: {
    "admin-attachment": adminAttachmentRelation,
  },
  commands: {
    "files:sign-upload": signUpload,
    "files:complete-upload": completeUpload,
    "files:attach-file": attachFileCommand,
    "files:delete-file": deleteFile,
  },
  queries: {
    "files:get-read-url": getReadUrl,
    "files:list-for-record": listForRecord,
  },
  // Phase 31 / QUO-03, OPS-03 — storage health contributor auto-registered into
  // the HealthAggregator by ModuleRegistry.loadAll() (registry.ts:128-130).
  health: storageHealthContributor,
  // IMG-01 — async variant generation. concurrency:2 caps worker memory (each
  // variant decodes a full image buffer); existing jobs keep the default 5.
  //
  // Phase 31 / OPS-02 — four repeatable cleanup/reconciliation jobs. The def.jobs
  // key === queue === SC identifier. Names are hyphen-delimited because BullMQ 5
  // forbids `:` in queue names (`:` is the Redis key separator) — `new Queue(name)`
  // throws "Queue name cannot contain :" otherwise (issue #3). Each carries a
  // `repeat.pattern` (5-field cron); the worker boot loop registers the schedule
  // via queue.upsertJobScheduler (idempotent by schedulerId === jobName).
  // Schedules are staggered so no two run together.
  jobs: {
    "files:transform-image": {
      queue: "image-transform",
      handler: transformImage,
      concurrency: 2,
    },
    "cleanup-reap-pending-uploads": {
      queue: "cleanup-reap-pending-uploads",
      handler: reapPendingUploads,
      repeat: { pattern: "0 * * * *" }, // hourly (top of the hour)
    },
    "quota-reconcile-tenant-usage": {
      queue: "quota-reconcile-tenant-usage",
      handler: reconcileTenantUsage,
      repeat: { pattern: "0 2 * * *" }, // daily 02:00
    },
    "cleanup-reap-orphan-files": {
      queue: "cleanup-reap-orphan-files",
      handler: reapOrphanFiles,
      repeat: { pattern: "30 3 * * *" }, // daily 03:30
    },
    "cleanup-reap-soft-deleted": {
      queue: "cleanup-reap-soft-deleted",
      handler: reapSoftDeleted,
      repeat: { pattern: "0 4 * * 0" }, // weekly Sunday 04:00
    },
  },
  events: [
    "file.signed",
    "file.completed",
    "file.deleted",
    "file.transformed",
    "file.transform-failed",
  ],
} satisfies ModuleDefinition;
