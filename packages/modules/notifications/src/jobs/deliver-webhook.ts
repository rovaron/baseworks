// packages/modules/notifications/src/jobs/deliver-webhook.ts
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { env } from "@baseworks/config";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { assertSafeWebhookUrl, isPrivateAddress } from "../lib/webhook-security";
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

/**
 * Production webhook POST. Resolves the host ONCE, rejects any private/internal
 * address, then connects to that exact validated IP (pinned) with the original
 * hostname as TLS SNI + `Host`. Pinning + `node:https` (which does NOT follow
 * redirects) together close two SSRF vectors that a plain `fetch` leaves open:
 *  - DNS rebinding (the IP validated is the IP connected to — no re-resolution).
 *  - 3xx redirect to an internal address (no redirect is ever followed; a 3xx
 *    is returned as-is and treated as a non-2xx failure upstream).
 */
const defaultHttpPost: WebhookDeps["httpPost"] = async (rawUrl, headers, body) => {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("Webhook URL must use https://");

  const addrs = await dnsLookup(url.hostname, { all: true });
  if (addrs.length === 0) throw new Error(`Webhook host did not resolve: ${url.hostname}`);
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `Webhook URL resolves to a private/internal address (${address}); not allowed`,
      );
    }
  }
  const pinnedIp = addrs[0].address;

  return await new Promise<{ status: number }>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: pinnedIp,
        servername: url.hostname, // SNI + certificate validation against the hostname
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, Host: url.host },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        res.resume(); // drain so the socket is released
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
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
    // Bump the endpoint's consecutive-failure count only on the FINAL attempt
    // (=== not >=, so a stalled-job re-run with attempts already past max does
    // not double-count). The increment + auto-disable run in ONE atomic UPDATE
    // computed in SQL — a read-modify-write off the captured row would lose
    // updates under worker concurrency, so auto-disable might never fire.
    if (attempt === WEBHOOK_MAX_ATTEMPTS) {
      const next = sql`(${notificationWebhook.consecutiveFailures}::int + 1)`;
      await db
        .update(notificationWebhook)
        .set({
          consecutiveFailures: sql`${next}::text`,
          lastStatus: "failed",
          lastDeliveryAt: new Date(),
          status: sql`CASE WHEN ${next} >= ${WEBHOOK_AUTO_DISABLE_THRESHOLD} THEN 'auto_disabled' ELSE ${notificationWebhook.status} END`,
          disabledReason: sql`CASE WHEN ${next} >= ${WEBHOOK_AUTO_DISABLE_THRESHOLD} THEN ${next}::text || ' consecutive failures' ELSE ${notificationWebhook.disabledReason} END`,
        })
        .where(eq(notificationWebhook.id, endpoint.id));
      logger.warn({ webhookId: endpoint.id }, "webhook delivery exhausted retries");
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
