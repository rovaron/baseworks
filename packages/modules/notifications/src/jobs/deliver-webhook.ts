// packages/modules/notifications/src/jobs/deliver-webhook.ts
import { env } from "@baseworks/config";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { assertSafeWebhookUrl } from "../lib/webhook-security";
import { signWebhook } from "../lib/webhook-signature";

const logger = pino({ name: "notifications-webhook" });

/** Must equal the queue's `attempts` default (createQueue → DEFAULT_JOB_OPTIONS.attempts = 3). */
export const WEBHOOK_MAX_ATTEMPTS = 3;
export const WEBHOOK_AUTO_DISABLE_THRESHOLD = 15;
const REQUEST_TIMEOUT_MS = 10_000;

export type WebhookJobPayload = { kind: "webhook-event"; deliveryId: string };

export interface WebhookDeps {
  // biome-ignore lint/suspicious/noExplicitAny: owner Drizzle client (worker context)
  db: () => any;
  httpPost: (
    url: string,
    headers: Record<string, string>,
    body: string,
  ) => Promise<{ status: number }>;
  lookup: (host: string) => Promise<Array<{ address: string }>>;
  now: () => number;
}

const defaultHttpPost: WebhookDeps["httpPost"] = async (url, headers, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { status: res.status };
};

const defaultDeps: Pick<WebhookDeps, "db" | "httpPost" | "now"> = {
  db: () => getDb(env.DATABASE_URL),
  httpPost: defaultHttpPost,
  now: () => Date.now(),
};

/**
 * `notifications-webhook` worker. Loads the delivery + endpoint, re-checks SSRF,
 * HMAC-signs, POSTs, and records the outcome. Throws on failure so BullMQ
 * retries. The persisted `attempts` counter (not BullMQ job metadata, which the
 * handler can't see) marks the final attempt that bumps the endpoint's
 * consecutive-failure count and auto-disables it.
 */
export async function deliverWebhook(
  payload: unknown,
  deps: Partial<WebhookDeps> = {},
): Promise<void> {
  const db = (deps.db ?? defaultDeps.db)();
  const httpPost = deps.httpPost ?? defaultDeps.httpPost;
  const now = deps.now ?? defaultDeps.now;
  const job = payload as WebhookJobPayload;

  const [delivery] = await db
    .select()
    .from(notificationWebhookDelivery)
    .where(eq(notificationWebhookDelivery.id, job.deliveryId))
    .limit(1);
  if (!delivery) return;

  const [endpoint] = await db
    .select()
    .from(notificationWebhook)
    .where(eq(notificationWebhook.id, delivery.webhookId))
    .limit(1);

  if (!endpoint || endpoint.status !== "active") {
    await db
      .update(notificationWebhookDelivery)
      .set({ status: "skipped", lastError: "endpoint not active" })
      .where(eq(notificationWebhookDelivery.id, delivery.id));
    return;
  }

  const attempt = Number(delivery.attempts) + 1;
  const body = JSON.stringify(delivery.payload);

  const recordFailure = async (message: string, httpStatus: string | null) => {
    await db
      .update(notificationWebhookDelivery)
      .set({ status: "failed", attempts: String(attempt), httpStatus, lastError: message })
      .where(eq(notificationWebhookDelivery.id, delivery.id));
    if (attempt >= WEBHOOK_MAX_ATTEMPTS) {
      const failures = Number(endpoint.consecutiveFailures) + 1;
      // biome-ignore lint/suspicious/noExplicitAny: partial column patch
      const patch: any = {
        consecutiveFailures: String(failures),
        lastStatus: "failed",
        lastDeliveryAt: new Date(),
      };
      if (failures >= WEBHOOK_AUTO_DISABLE_THRESHOLD) {
        patch.status = "auto_disabled";
        patch.disabledReason = `${failures} consecutive failures`;
        logger.warn({ webhookId: endpoint.id, failures }, "webhook endpoint auto-disabled");
      }
      await db
        .update(notificationWebhook)
        .set(patch)
        .where(eq(notificationWebhook.id, endpoint.id));
    }
  };

  let res: { status: number };
  try {
    await assertSafeWebhookUrl(endpoint.url, { lookup: deps.lookup });
    const ts = Math.floor(now() / 1000);
    const signature = signWebhook(endpoint.secret, body, ts);
    res = await httpPost(
      endpoint.url,
      {
        "content-type": "application/json",
        "X-Baseworks-Signature": signature,
      },
      body,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordFailure(message, null);
    throw err; // BullMQ retry
  }

  if (res.status >= 200 && res.status < 300) {
    await db
      .update(notificationWebhookDelivery)
      .set({
        status: "success",
        httpStatus: String(res.status),
        attempts: String(attempt),
        deliveredAt: new Date(),
        lastError: null,
      })
      .where(eq(notificationWebhookDelivery.id, delivery.id));
    await db
      .update(notificationWebhook)
      .set({ consecutiveFailures: "0", lastStatus: "success", lastDeliveryAt: new Date() })
      .where(eq(notificationWebhook.id, endpoint.id));
    return;
  }

  await recordFailure(`Non-2xx response: ${res.status}`, String(res.status));
  throw new Error(`Webhook delivery failed with status ${res.status}`); // BullMQ retry
}
