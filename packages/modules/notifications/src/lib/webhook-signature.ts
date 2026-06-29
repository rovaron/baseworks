// packages/modules/notifications/src/lib/webhook-signature.ts
import { createHmac } from "node:crypto";

/**
 * Sign a webhook body Stripe-style. The timestamp is part of the signed payload
 * (`<timestamp>.<body>`) so receivers can reject replays. Header value format:
 * `t=<unix-seconds>,v1=<hex-hmac-sha256>`.
 */
export function signWebhook(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}
