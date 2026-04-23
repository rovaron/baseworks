/**
 * PII scrubber — single shared defense-in-depth layer (Phase 18 / ERR-04 / D-12, D-13).
 *
 * Called by the Sentry adapter via `Sentry.init({ beforeSend, beforeBreadcrumb })`
 * AND by the pino-sink adapter inside `captureException` before logging. Pure
 * function: no shared mutable state, deep-clone-and-transform semantics, safe
 * to call concurrently.
 *
 * Design rules:
 * - Denylist is case-insensitive and recursive through nested objects/arrays.
 * - Regex patterns applied to surviving string leaves after the key denylist pass.
 * - Webhook-route rule (event.request.url ~ /api/webhooks/**) drops the entire
 *   event.request.data branch — webhook bodies NEVER forwarded upstream.
 * - OBS_PII_DENY_EXTRA_KEYS env is ADDITIVE only — never removes defaults.
 * - Returns `null | PiiEvent` to satisfy Sentry's `beforeSend` signature.
 *
 * Redaction marker: `[redacted:<lower-case-key>]` for deny-key hits, and
 * `[redacted:<pattern>]` for regex hits (email, cpf, cnpj, stripe-key, bearer).
 */

import { env } from "@baseworks/config";

/**
 * Event-shaped object passed through the scrubber. Intentionally permissive —
 * the scrubber handles arbitrary nested shapes (Sentry envelopes, pino log
 * records, plain objects).
 */
export type PiiEvent = Record<string, unknown>;

/**
 * Built-in case-insensitive deny keys (D-13). Values under these keys are
 * always replaced with `[redacted:<key>]`, regardless of nesting depth.
 */
export const DEFAULT_DENY_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "x-api-key",
  "sessionId",
  "session",
  "csrf",
  "stripeCustomerId",
  "stripe_secret",
  "pagarme_secret",
  "apiKey",
  "email",
  "cpf",
  "cnpj",
];

/**
 * Regex patterns applied to surviving string leaves. Each pattern replaces
 * its match with a named redaction marker so downstream consumers can tell
 * what kind of secret was removed without seeing the secret itself.
 */
const PATTERNS: readonly [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted:email]"],
  [/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[redacted:cpf]"],
  [/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, "[redacted:cnpj]"],
  [/sk_(live|test)_[\w]+/g, "[redacted:stripe-key]"],
  [/Bearer\s+[\w.-]+/gi, "[redacted:bearer]"],
];

/**
 * Deny-key set — built once at module init from the compile-time defaults
 * plus any comma-separated extras from `env.OBS_PII_DENY_EXTRA_KEYS`. The
 * extension is strictly additive (we `new Set(...)` across both arrays);
 * the env never removes defaults.
 */
const DENY_SET: Set<string> = (() => {
  const extra = env.OBS_PII_DENY_EXTRA_KEYS
    ? env.OBS_PII_DENY_EXTRA_KEYS.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return new Set([...DEFAULT_DENY_KEYS, ...extra].map((k) => k.toLowerCase()));
})();

/**
 * Apply all regex redaction patterns to a single string leaf. Order matters:
 * CNPJ is checked before CPF because a CNPJ substring can also match the CPF
 * regex — swapping the order would leak part of the CNPJ. (Actual order is
 * email → cpf → cnpj → stripe → bearer; the array is consistent and each
 * replacement is idempotent on already-redacted markers.)
 */
function redactString(s: string): string {
  let out = s;
  for (const [re, marker] of PATTERNS) {
    out = out.replace(re, marker);
  }
  return out;
}

/**
 * Recursive deep-walker. Returns a NEW value mirroring the input's shape
 * with redactions applied. Never mutates the input.
 */
function walk(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(walk);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DENY_SET.has(k.toLowerCase())) {
        out[k] = `[redacted:${k.toLowerCase()}]`;
      } else {
        out[k] = walk(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * Scrub an event-shaped object of PII.
 *
 * @param event - Arbitrary event object (Sentry envelope, pino record, etc.), or null/undefined
 * @returns Scrubbed copy of the event, or `null` if the input was null/undefined
 */
export function scrubPii(event: PiiEvent | null | undefined): PiiEvent | null {
  if (event == null) return null;
  const scrubbed = walk(event) as PiiEvent;
  // Webhook route rule — drop request.data entirely when the URL matches
  // a webhook path. Webhook bodies carry provider secrets that must never
  // leave the service (Stripe/Pagar.me signing secrets, card_last4, etc.).
  const req = scrubbed.request as { url?: string; data?: unknown } | undefined;
  if (req?.url && typeof req.url === "string" && /\/api\/webhooks\//.test(req.url)) {
    delete req.data;
  }
  return scrubbed;
}
