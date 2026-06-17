/**
 * Phase 26 / QUO-01 — create the tenant_storage_usage row on tenant creation.
 * Phase 27 / MOD-03 — generic cascade soft-delete subscriber.
 *
 * `registerFilesHooks` wires the files module onto the registry event bus. It
 * runs in apps/api AFTER `registry.loadAll()`, so `fileRelationsRegistry` is
 * fully populated when the cascade subscriptions are derived from it.
 *
 * tenant.created: idempotent (ON CONFLICT (tenant_id) DO NOTHING) and resilient
 * — a failure here MUST NOT crash tenant creation (emit is fire-and-forget), so
 * the insert is wrapped in try/catch and reported via getErrorTracker().
 *
 * cascade (MOD-03 / SC#5): for every relation declared `onDelete: "cascade"`, we
 * subscribe to its canonical owner-deletion event
 * `${ownerModule}.${recordType}-deleted` with payload `{ tenantId, recordId }`.
 * When that fires we soft-delete the owner's files and refund counted bytes via
 * `cascadeSoftDelete`. The deletion-event PRODUCER (e.g. `auth.user-deleted`) is
 * wired in a later phase — auth has no user-deletion command/emit today, so this
 * phase does NOT touch auth; the subscriber is exercised by emitting the event
 * in-test. Phase 29's producer MUST conform to the `{ tenantId, recordId }`
 * payload pinned here.
 */

import { env } from "@baseworks/config";
import { getDb, tenantStorageUsage } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";
import { fileRelationsRegistry } from "@baseworks/storage";
import { sql } from "drizzle-orm";
import { cascadeSoftDelete } from "../lib/cascade";
import { findRelationByRecordType } from "../lib/relation-lookup";

/** Minimal BullMQ Queue surface this hook needs (avoids a direct `bullmq` type
 *  dependency on the files package — the real Queue from `createQueue` satisfies
 *  it; the worker carries bullmq transitively). */
interface EnqueueOnlyQueue {
  add: (name: string, data: unknown) => Promise<unknown>;
}

interface TenantCreatedEvent {
  tenantId: string;
  name?: string;
}

/**
 * Phase 27 emit payload for `file.completed` (commands/complete-upload.ts).
 */
interface FileCompletedEvent {
  fileId: string;
  tenantId: string;
  byteSize: number;
  mimeType: string;
}

/**
 * Phase 28 / IMG-01 — lazy BullMQ queue for the image-transform pipeline. Only
 * created when REDIS_URL is set; in dev/test without Redis the subscriber skips
 * (variants are best-effort, never block the upload flow). Unlike billing's
 * provision hook we do NOT run inline — a synchronous sharp transform has no
 * place in the API request/emit path (memory + latency).
 *
 * `createQueue` is imported DYNAMICALLY (not at module top-level) so that merely
 * calling `registerFilesHooks` does not pull `@baseworks/queue` — which imports
 * `wrapQueue` from `@baseworks/observability` — into the import graph. Tests that
 * mock `@baseworks/observability` with a partial stub (tenant.created / cascade
 * suites) would otherwise fail to resolve `wrapQueue`. The queue is only ever
 * needed at enqueue time, deep inside the async `file.completed` handler.
 */
let transformQueue: EnqueueOnlyQueue | null = null;
async function getTransformQueue(): Promise<EnqueueOnlyQueue | null> {
  if (!transformQueue && env.REDIS_URL) {
    const { createQueue } = await import("@baseworks/queue");
    transformQueue = createQueue("image-transform", env.REDIS_URL);
  }
  return transformQueue;
}

/** Minimal event-bus surface the files hooks depend on (TypedEventBus satisfies it).
 *  `emit` is optional so bare `{ on }` test doubles (Phase 26 tenant.created tests)
 *  still satisfy it; the cascade path falls back to a no-op when it is absent. */
interface FilesEventBus {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
  emit?: (event: string, data: unknown) => void;
}

/**
 * Register files hooks on the event bus.
 *
 * @param eventBus - The TypedEventBus instance from the module registry.
 */
export function registerFilesHooks(eventBus: FilesEventBus): void {
  // QUO-01 — provision the per-tenant usage row.
  eventBus.on("tenant.created", async (data: unknown) => {
    const { tenantId } = data as TenantCreatedEvent;
    try {
      const db = getDb(env.DATABASE_URL);
      await db
        .insert(tenantStorageUsage)
        .values({
          tenantId,
          bytesUsed: 0,
          bytesPending: 0,
          // Explicit so the row is observable with a concrete limit (SC#2).
          bytesLimit: env.STORAGE_DEFAULT_QUOTA_BYTES,
        })
        .onConflictDoNothing({ target: tenantStorageUsage.tenantId });
    } catch (err) {
      // Failure here must NOT crash the tenant-creation flow (fire-and-forget);
      // report it so it stays observable/alertable.
      getErrorTracker().captureException(err, {
        tenantId,
        tags: { module: "files", hook: "tenant.created" },
      });
    }
  });

  // IMG-01 — enqueue async image-variant generation on a completed upload.
  // file.completed is emitted by complete-upload AFTER the commit (API process).
  // Best-effort: a throw here never crashes the upload flow (emit is
  // fire-and-forget) — try/catch + ErrorTracker, mirroring the two subscribers
  // above. Trace propagation is automatic (createQueue's Phase-20 producer
  // wrapper injects _otel/_requestId/... from the active obsContext frame).
  eventBus.on("file.completed", async (data: unknown) => {
    const { fileId, tenantId, mimeType } = data as FileCompletedEvent;
    try {
      // GATE 1 — raster images only. SVG (image/svg+xml) is excluded here as
      // defense-in-depth: the output port union already bans SVG (XSS) and the
      // worker re-rejects non-raster sources, but refusing to enqueue it at all
      // keeps a hostile vector (librsvg SSRF/external-entity load) out of the
      // worker entirely.
      if (!mimeType?.startsWith("image/")) return;
      if (mimeType === "image/svg+xml") return;

      // GATE 2 — the relation must declare generateVariants. Recover it from the
      // row's (owner_module, owner_record_type) via a tenant-scoped 2-col read
      // (allow-listed direct files access).
      const db = getDb(env.DATABASE_URL);
      const rows = (await db.execute(sql`
        SELECT owner_module, owner_record_type
          FROM files
         WHERE id = ${fileId}
           AND tenant_id = ${tenantId}
           AND deleted_at IS NULL
         LIMIT 1
      `)) as unknown as Array<{ owner_module: string; owner_record_type: string }>;
      const row = rows[0];
      if (!row) return;

      const relation = findRelationByRecordType(row.owner_module, row.owner_record_type);
      if (!relation?.generateVariants?.length) return;

      const queue = await getTransformQueue();
      if (!queue) {
        // Dev/no-Redis: skip silently (variants are best-effort; no inline sharp).
        return;
      }
      await queue.add("files:transform-image", { fileId, tenantId });
    } catch (err) {
      getErrorTracker().captureException(err, {
        tenantId,
        tags: { module: "files", hook: "file.completed" },
      });
    }
  });

  // MOD-03 / SC#5 — generic cascade soft-delete. Derive one subscription per
  // distinct owner-deletion event from the relations declared `onDelete:
  // "cascade"`. Two kinds in a module may share a recordType, so dedupe by event
  // name to avoid double-handling a single deletion.
  const seen = new Set<string>();
  for (const [key, relation] of fileRelationsRegistry.getAll()) {
    if (relation.onDelete !== "cascade") continue;
    const ownerModule = key.slice(0, key.indexOf(":"));
    const recordType = relation.recordType;
    const eventName = `${ownerModule}.${recordType}-deleted`;
    if (seen.has(eventName)) continue;
    seen.add(eventName);

    // Bound emit (no-op fallback for bare test buses without `emit`).
    const emit: (event: string, data: unknown) => void = eventBus.emit
      ? eventBus.emit.bind(eventBus)
      : () => {};

    eventBus.on(eventName, async (data: unknown) => {
      const payload = data as { tenantId?: string; recordId?: string } | null;
      const tenantId = payload?.tenantId;
      const recordId = payload?.recordId;
      // Malformed event → ignore (resilient; never throw out of a subscriber).
      if (!tenantId || !recordId) return;
      try {
        await cascadeSoftDelete(getDb(env.DATABASE_URL), {
          tenantId,
          ownerModule,
          recordType,
          recordId,
          emit,
        });
      } catch (err) {
        getErrorTracker().captureException(err, {
          tenantId,
          tags: { module: "files", hook: eventName },
        });
      }
    });
  }
}
