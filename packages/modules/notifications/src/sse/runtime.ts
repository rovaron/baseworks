// packages/modules/notifications/src/sse/runtime.ts
import { env } from "@baseworks/config";
import { getDb } from "@baseworks/db";
import { getRedisConnection } from "@baseworks/queue";
import { EmailAdapter } from "../channels/email";
import { InAppAdapter } from "../channels/in-app";
import { registerAdapter } from "../channels/registry";
import { ResendEmailProvider } from "../channels/resend-provider";
import { SseBridge } from "./bridge";

let bridge: SseBridge | undefined;
let wired = false;

/** Idempotent: register the in-app adapter (publish via shared connection) + build the bridge (dedicated subscriber). */
export function ensureNotificationsRuntime(): void {
  if (wired || !env.REDIS_URL) return;
  const pub = getRedisConnection(env.REDIS_URL);
  registerAdapter(new InAppAdapter({ publish: (c, m) => pub.publish(c, m) }));
  // Email channel: notify() enqueues a `channel-delivery` job onto
  // `notifications-deliver`; the worker reuses this same adapter to render+send.
  registerAdapter(
    new EmailAdapter(new ResendEmailProvider(env.RESEND_API_KEY), getDb(env.DATABASE_URL)),
  );
  // Dedicated subscriber connection (ioredis enters subscriber mode on the first
  // SUBSCRIBE). `enableReadyCheck: false` suppresses the post-connect `INFO`
  // probe, which otherwise races a buffered SUBSCRIBE and throws "Connection in
  // subscriber mode, only subscriber commands may be used" under load — a
  // subscriber-only socket never needs the readiness probe.
  bridge = new SseBridge(getRedisConnection(env.REDIS_URL).duplicate({ enableReadyCheck: false }));
  wired = true;
}

export function getSseBridge(): SseBridge {
  ensureNotificationsRuntime();
  if (!bridge) throw new Error("notifications runtime requires REDIS_URL");
  return bridge;
}
