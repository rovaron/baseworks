// packages/modules/notifications/src/jobs/deliver.ts
import { env } from "@baseworks/config";
import { getDb, notification, notificationDelivery } from "@baseworks/db";
import { eq } from "drizzle-orm";
import type { DeliverableNotification } from "../channels/channel";
import { EmailAdapter } from "../channels/email";
import type { EmailProvider } from "../channels/email-provider";
import { ResendEmailProvider } from "../channels/resend-provider";
import { renderEmail } from "../lib/email-render";

/**
 * Project a persisted `notification` row onto the minimal shape a channel
 * adapter consumes. Explicit (rather than a blanket `as`) so a schema/contract
 * drift surfaces as a compile error here instead of silently mis-delivering.
 */
function toDeliverable(row: typeof notification.$inferSelect): DeliverableNotification {
  return {
    id: row.id,
    tenantId: row.tenantId,
    recipientUserId: row.recipientUserId,
    type: row.type,
    category: row.category,
    severity: row.severity as DeliverableNotification["severity"],
    title: row.title,
    body: row.body,
    url: row.url,
    data: row.data as Record<string, unknown> | null,
    actions: row.actions,
  };
}

/**
 * Discriminated payload for the `notifications-deliver` worker.
 *
 * - `transactional-email`: address-only emails (auth/billing producers). Render
 *   a named template and send it — no db access required.
 * - `channel-delivery`: a tenant notification row delivered over a non-in-app
 *   channel (email this phase; webhook in Phase 4). Loads the delivery +
 *   notification rows via the owner db and runs the channel adapter.
 */
export type DeliverPayload =
  | { kind: "transactional-email"; to: string; template: string; data: Record<string, unknown> }
  | { kind: "channel-delivery"; deliveryId: string; channel: string };

/**
 * Injectable dependencies — seams that let tests substitute a fake provider/db
 * so the worker can be exercised without Redis or Postgres. Production uses the
 * Resend provider and the owner db (worker is cross-tenant/trusted).
 */
export interface DeliverDeps {
  provider: () => EmailProvider;
  // biome-ignore lint/suspicious/noExplicitAny: owner Drizzle client (worker context)
  db: () => any;
}

const defaultDeps: DeliverDeps = {
  provider: () => new ResendEmailProvider(env.RESEND_API_KEY),
  db: () => getDb(env.DATABASE_URL),
};

/**
 * `notifications-deliver` worker handler. Branches on `payload.kind`:
 * renders+sends a transactional email, or delivers a tenant notification over
 * its channel and records the outcome on the `notification_delivery` row.
 *
 * @param payload - The job data ({@link DeliverPayload}).
 * @param deps - Injectable provider/db seams (defaults to Resend + owner db).
 */
export async function deliver(payload: unknown, deps: Partial<DeliverDeps> = {}): Promise<void> {
  const provider = deps.provider ?? defaultDeps.provider;
  const dbFactory = deps.db ?? defaultDeps.db;
  const job = payload as DeliverPayload;

  if (job.kind === "transactional-email") {
    const { html, subject } = await renderEmail(job.template, job.data);
    await provider().send({ to: job.to, subject, html });
    return;
  }

  // channel-delivery (tenant notification). Owner db (worker is cross-tenant/trusted).
  const db = dbFactory();
  const [delivery] = await db
    .select()
    .from(notificationDelivery)
    .where(eq(notificationDelivery.id, job.deliveryId))
    .limit(1);
  if (!delivery) return;

  const [notif] = await db
    .select()
    .from(notification)
    .where(eq(notification.id, delivery.notificationId))
    .limit(1);
  if (!notif) return;

  let result: {
    status: "sent" | "failed" | "skipped";
    error?: string;
    providerMessageId?: string;
  } = { status: "skipped" };
  try {
    if (job.channel === "email") {
      const adapter = new EmailAdapter(provider(), db);
      const r = await adapter.deliver(toDeliverable(notif), delivery.id);
      result =
        r.status === "sent"
          ? { status: "sent", providerMessageId: r.providerMessageId }
          : r.status === "failed"
            ? { status: "failed", error: r.error }
            : { status: "skipped", error: r.reason };
    }
  } catch (err) {
    result = { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }

  await db
    .update(notificationDelivery)
    .set({
      status: result.status,
      error: result.error ?? null,
      providerMessageId: result.providerMessageId ?? null,
    })
    .where(eq(notificationDelivery.id, delivery.id));
}
