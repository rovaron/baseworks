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
import { cascadeSoftDelete } from "../lib/cascade";

interface TenantCreatedEvent {
  tenantId: string;
  name?: string;
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
