/**
 * Phase 26 / QUO-01 — create the tenant_storage_usage row on tenant creation.
 *
 * Idempotent (ON CONFLICT (tenant_id) DO NOTHING) and resilient: a failure here
 * MUST NOT crash tenant creation (emit is fire-and-forget), so the insert is
 * wrapped in try/catch and any error is reported via getErrorTracker(). Mirrors
 * the billing hook's resilience pattern.
 *
 * Registered as a listener on `tenant.created` via the TypedEventBus.
 */

import { env } from "@baseworks/config";
import { getDb, tenantStorageUsage } from "@baseworks/db";
import { getErrorTracker } from "@baseworks/observability";

interface TenantCreatedEvent {
  tenantId: string;
  name?: string;
}

/**
 * Register files hooks on the event bus.
 *
 * @param eventBus - The TypedEventBus instance from the module registry.
 */
export function registerFilesHooks(eventBus: {
  on: (event: string, handler: (data: any) => Promise<void>) => void;
}): void {
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
}
