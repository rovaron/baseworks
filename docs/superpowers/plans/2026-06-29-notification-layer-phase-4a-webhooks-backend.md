# Notification Layer Phase 4a — Webhook Backend Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for an outbound webhook channel — schema, once-per-event dispatcher in `notify()`, a dedicated `notifications-webhook` queue + worker (SSRF-guarded, HMAC-signed, auto-disabling), and a daily retention prune job.

**Architecture:** Webhooks fire **once per logical event** (not per recipient). After `notify()` persists per-recipient notification rows, it loads the tenant's active endpoints subscribed to the notification's `category`, writes one `notification_webhook_delivery` row per endpoint, and enqueues a `{kind:"webhook-event", deliveryId}` job onto a dedicated `notifications-webhook` BullMQ queue. A worker re-validates the URL (SSRF), HMAC-signs the body, POSTs it, and records the outcome — throwing on failure so BullMQ retries (3 attempts, exponential backoff). The per-delivery `attempts` counter (persisted on the row, NOT read from BullMQ job metadata, which the handler can't see) detects the final failed attempt to bump the endpoint's consecutive-failure count and auto-disable at 15. A daily repeat job prunes old delivery rows.

**Tech Stack:** Bun, Drizzle (postgres.js), BullMQ + ioredis, `node:crypto` (HMAC), `node:dns/promises` (SSRF DNS resolution), TypeBox, `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-29-notification-layer-phase-4-webhooks-design.md`
**Branch:** `feat/notifications-phase-4` (already checked out)
**Out of scope for 4a:** endpoint CRUD API (4b), web/admin UIs (4c/4d).

---

## File Structure

**Create:**
- `packages/modules/notifications/src/lib/webhook-signature.ts` — pure HMAC-SHA256 signer.
- `packages/modules/notifications/src/lib/webhook-security.ts` — SSRF URL guard (https + DNS + private-range rejection).
- `packages/modules/notifications/src/lib/webhook-queue.ts` — memoized `getWebhookQueue()` for the `notifications-webhook` queue.
- `packages/modules/notifications/src/lib/webhook-dispatch.ts` — pure helper that builds the delivery-row values for matching endpoints.
- `packages/modules/notifications/src/jobs/deliver-webhook.ts` — `notifications-webhook` worker handler.
- `packages/modules/notifications/src/jobs/prune-webhook-deliveries.ts` — daily retention prune handler.
- Tests: `lib/__tests__/webhook-signature.test.ts`, `lib/__tests__/webhook-security.test.ts`, `lib/__tests__/webhook-dispatch.test.ts`, `jobs/__tests__/deliver-webhook.test.ts`, `jobs/__tests__/prune-webhook-deliveries.test.ts`, `__integration__/notify-webhook.test.ts`.

**Modify:**
- `packages/db/src/schema/notifications.ts` — extend `notification_webhook`, add `notification_webhook_delivery`.
- `packages/db/migrations/<generated>.sql` — generated + hand-edited backfill.
- `packages/config/src/env.ts` — add `WEBHOOK_DELIVERY_RETENTION_DAYS`.
- `packages/modules/notifications/src/catalog.ts` — add `webhookable?: boolean`.
- `packages/modules/notifications/src/commands/notify.ts` — dispatch webhooks after the recipient loop.
- `packages/modules/notifications/src/index.ts` — register the two new jobs.

---

## Task 1: Schema — extend `notification_webhook` + add `notification_webhook_delivery`

**Files:**
- Modify: `packages/db/src/schema/notifications.ts`

- [ ] **Step 1: Replace the `notification_webhook` table definition and add the delivery table**

In `packages/db/src/schema/notifications.ts`, replace the existing `notificationWebhook` block:

```ts
/** Tenant outbound webhook endpoints. */
export const notificationWebhook = pgTable(
  "notification_webhook",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    categories: jsonb("categories"),
    description: text("description"),
    // active | disabled (tenant) | auto_disabled (system, after repeated failures)
    status: text("status").notNull().default("active"),
    consecutiveFailures: text("consecutive_failures").notNull().default("0"),
    lastDeliveryAt: timestamp("last_delivery_at"),
    lastStatus: text("last_status"), // success | failed
    disabledReason: text("disabled_reason"),
    ...timestampColumns(),
  },
  (t) => [tenantRlsPolicy("notification_webhook_tenant_isolation", t.tenantId)],
);

/** Per (event, endpoint) delivery audit — updated in place across retries. */
export const notificationWebhookDelivery = pgTable(
  "notification_webhook_delivery",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    webhookId: text("webhook_id").notNull(),
    eventType: text("event_type").notNull(),
    category: text("category").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull(), // pending | success | failed | skipped
    httpStatus: text("http_status"),
    attempts: text("attempts").notNull().default("0"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at"),
    ...timestampColumns(),
  },
  (t) => [
    index("notification_webhook_delivery_lookup_idx").on(t.tenantId, t.webhookId, t.createdAt),
    tenantRlsPolicy("notification_webhook_delivery_tenant_isolation", t.tenantId),
  ],
);
```

(The `boolean` import stays — `notificationPreference` still uses it. `index`, `jsonb`, `text`, `timestamp` are already imported.)

- [ ] **Step 2: Typecheck the schema package**

Run: `bun run typecheck`
Expected: PASS (no references to the removed `enabled` column exist yet — CRUD is 4b).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/notifications.ts
git commit -m "feat(notifications): webhook schema — status tri-state + delivery audit table"
```

---

## Task 2: Generate + backfill the migration

**Files:**
- Create: `packages/db/migrations/<timestamp>_*.sql` (drizzle-generated, then hand-edited)

- [ ] **Step 1: Generate the migration**

Run: `bun run db:generate`
Expected: a new SQL file under `packages/db/migrations/` that ADDs `status`, `description`, `consecutive_failures`, `last_delivery_at`, `last_status`, `disabled_reason`, DROPs `enabled`, and CREATEs `notification_webhook_delivery` (+ its index + RLS policy).

- [ ] **Step 2: Hand-edit to backfill `status` from `enabled` before the column is dropped**

Open the generated file. Ensure the order is: add `status` (with its `DEFAULT 'active'`), then a backfill UPDATE, then drop `enabled`. Insert this UPDATE immediately AFTER the `ADD COLUMN "status"` line and BEFORE the `DROP COLUMN "enabled"` line:

```sql
UPDATE "notification_webhook" SET "status" = CASE WHEN "enabled" THEN 'active' ELSE 'disabled' END;
```

(Existing rows: `enabled=true → active`, `enabled=false → disabled`. No row is `auto_disabled` at migration time.)

- [ ] **Step 3: Apply the migration**

Run: `bun run db:migrate`
Expected: migration applies cleanly; `notification_webhook_delivery` exists.

- [ ] **Step 4: Verify the tables**

Run: `bun run db:migrate` again
Expected: "No migrations to apply" (idempotent — confirms it recorded).

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(notifications): webhook schema migration + enabled→status backfill"
```

---

## Task 3: Config — `WEBHOOK_DELIVERY_RETENTION_DAYS`

**Files:**
- Modify: `packages/config/src/env.ts`

- [ ] **Step 1: Add the env var to `serverSchema`**

In `packages/config/src/env.ts`, add alongside the other retention vars (near `STORAGE_SOFT_DELETE_RETENTION_DAYS`):

```ts
  // Days to retain notification_webhook_delivery rows before the daily prune job deletes them.
  WEBHOOK_DELIVERY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/env.ts
git commit -m "feat(config): WEBHOOK_DELIVERY_RETENTION_DAYS (default 30)"
```

---

## Task 4: HMAC signature helper

**Files:**
- Create: `packages/modules/notifications/src/lib/webhook-signature.ts`
- Test: `packages/modules/notifications/src/lib/__tests__/webhook-signature.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/lib/__tests__/webhook-signature.test.ts
import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { signWebhook } from "../webhook-signature";

describe("signWebhook", () => {
  test("produces t=<ts>,v1=<hmac> over `<ts>.<body>`", () => {
    const secret = "whsec_test";
    const body = '{"event":"system.test"}';
    const ts = 1_700_000_000;
    const expectedMac = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

    expect(signWebhook(secret, body, ts)).toBe(`t=${ts},v1=${expectedMac}`);
  });

  test("different body → different signature (tamper-evident)", () => {
    const a = signWebhook("s", "a", 1);
    const b = signWebhook("s", "b", 1);
    expect(a).not.toBe(b);
  });

  test("timestamp is part of the signed payload (replay-evident)", () => {
    const a = signWebhook("s", "body", 1);
    const b = signWebhook("s", "body", 2);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-signature.test.ts`
Expected: FAIL — `Cannot find module "../webhook-signature"`.

- [ ] **Step 3: Write the implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-signature.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/lib/webhook-signature.ts packages/modules/notifications/src/lib/__tests__/webhook-signature.test.ts
git commit -m "feat(notifications): HMAC-SHA256 webhook signature helper"
```

---

## Task 5: SSRF URL guard

**Files:**
- Create: `packages/modules/notifications/src/lib/webhook-security.ts`
- Test: `packages/modules/notifications/src/lib/__tests__/webhook-security.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/lib/__tests__/webhook-security.test.ts
import { describe, expect, test } from "bun:test";
import { assertSafeWebhookUrl, isPrivateAddress } from "../webhook-security";

const pub = async () => [{ address: "93.184.216.34" }]; // example.com, public

describe("isPrivateAddress", () => {
  test.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ])("flags %s as private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each(["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946"])(
    "allows public %s",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("assertSafeWebhookUrl", () => {
  test("rejects non-https", async () => {
    await expect(assertSafeWebhookUrl("http://example.com/hook", { lookup: pub })).rejects.toThrow(
      /https/i,
    );
  });

  test("rejects a public-DNS name that resolves to a private IP (DNS rebinding)", async () => {
    await expect(
      assertSafeWebhookUrl("https://rebind.example/hook", {
        lookup: async () => [{ address: "169.254.169.254" }],
      }),
    ).rejects.toThrow(/private|internal|not allowed/i);
  });

  test("rejects when ANY resolved address is private", async () => {
    await expect(
      assertSafeWebhookUrl("https://mixed.example/hook", {
        lookup: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.1" }],
      }),
    ).rejects.toThrow(/private|internal|not allowed/i);
  });

  test("accepts a public https URL and returns the parsed URL", async () => {
    const url = await assertSafeWebhookUrl("https://example.com/hook", { lookup: pub });
    expect(url.hostname).toBe("example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-security.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/modules/notifications/src/lib/webhook-security.ts
import { lookup as dnsLookup } from "node:dns/promises";

export interface UrlGuardDeps {
  /** Resolve a hostname to all of its addresses. Injectable for tests. */
  lookup: (host: string) => Promise<Array<{ address: string }>>;
}

const defaultLookup: UrlGuardDeps["lookup"] = (host) => dnsLookup(host, { all: true });

/** True if `ip` is loopback, link-local, private (RFC1918/ULA), or unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) → evaluate the embedded IPv4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1] : /^\d+\.\d+\.\d+\.\d+$/.test(addr) ? addr : null;

  if (v4) {
    const o = v4.split(".").map(Number);
    if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → deny
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 10) return true; // 10/8
    if (o[0] === 127) return true; // loopback
    if (o[0] === 169 && o[1] === 254) return true; // link-local incl. 169.254.169.254
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
    return false;
  }

  // IPv6
  if (addr === "::" || addr === "::1") return true; // unspecified / loopback
  if (addr.startsWith("fe80")) return true; // link-local
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  return false;
}

/**
 * Validate a tenant-supplied webhook URL against SSRF. Requires `https://`,
 * resolves DNS, and rejects if ANY resolved address is private/loopback/
 * link-local (defeats DNS-rebinding). Runs at registration AND at delivery time.
 * @returns the parsed URL on success.
 * @throws Error if the URL is unsafe.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  deps: Partial<UrlGuardDeps> = {},
): Promise<URL> {
  const lookup = deps.lookup ?? defaultLookup;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid webhook URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use https://");
  }

  const addrs = await lookup(url.hostname);
  if (addrs.length === 0) throw new Error(`Webhook host did not resolve: ${url.hostname}`);
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new Error(`Webhook URL resolves to a private/internal address (${address}); not allowed`);
    }
  }
  return url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-security.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/lib/webhook-security.ts packages/modules/notifications/src/lib/__tests__/webhook-security.test.ts
git commit -m "feat(notifications): SSRF guard for webhook URLs (https + private-range rejection)"
```

---

## Task 6: Memoized webhook queue helper

**Files:**
- Create: `packages/modules/notifications/src/lib/webhook-queue.ts`

- [ ] **Step 1: Write the implementation** (no unit test — thin env/Redis wrapper, mirrors `deliver-queue.ts` which is exercised via the dispatcher/integration tests)

```ts
// packages/modules/notifications/src/lib/webhook-queue.ts
import { env } from "@baseworks/config";
import { createQueue } from "@baseworks/queue";

/**
 * Lazily-created, memoized handle to the dedicated `notifications-webhook` queue.
 *
 * Separate from `notifications-deliver` so slow/flaky third-party POSTs don't
 * sit in the same worker lane as latency-sensitive transactional email. Returns
 * `null` when `REDIS_URL` is unset (dev/test) so callers degrade gracefully.
 */
let queue: ReturnType<typeof createQueue> | null = null;

export function getWebhookQueue(): ReturnType<typeof createQueue> | null {
  if (!queue && env.REDIS_URL) {
    queue = createQueue("notifications-webhook", env.REDIS_URL);
  }
  return queue;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/lib/webhook-queue.ts
git commit -m "feat(notifications): memoized notifications-webhook queue helper"
```

---

## Task 7: Catalog — `webhookable` suppression flag

**Files:**
- Modify: `packages/modules/notifications/src/catalog.ts`

- [ ] **Step 1: Add the optional field to `CatalogEntry`**

In `packages/modules/notifications/src/catalog.ts`, add to the `CatalogEntry` interface (after `required?`):

```ts
  /**
   * When false, this type never dispatches webhooks even if a tenant endpoint
   * subscribes to its category (for sensitive/internal-only notifications).
   * Defaults to true (webhook-eligible) when omitted.
   */
  webhookable?: boolean;
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (the existing `system.test` entry omits the field → eligible).

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/catalog.ts
git commit -m "feat(notifications): catalog webhookable suppression flag"
```

---

## Task 8: Pure dispatch helper (eligibility + delivery-row values)

**Files:**
- Create: `packages/modules/notifications/src/lib/webhook-dispatch.ts`
- Test: `packages/modules/notifications/src/lib/__tests__/webhook-dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/lib/__tests__/webhook-dispatch.test.ts
import { describe, expect, test } from "bun:test";
import { buildWebhookDeliveries, type WebhookEndpointRow } from "../webhook-dispatch";

const ep = (over: Partial<WebhookEndpointRow>): WebhookEndpointRow => ({
  id: "e1",
  status: "active",
  categories: ["system"],
  ...over,
});

const event = {
  tenantId: "t1",
  eventType: "system.test",
  category: "system",
  recipientUserIds: ["u1", "u2"],
  data: { message: "hi" },
  occurredAt: "2026-06-29T00:00:00.000Z",
};

describe("buildWebhookDeliveries", () => {
  test("selects active endpoints subscribed to the category and builds one row each", () => {
    const rows = buildWebhookDeliveries(
      [ep({ id: "e1" }), ep({ id: "e2", categories: ["billing"] }), ep({ id: "e3" })],
      event,
    );
    expect(rows.map((r) => r.webhookId).sort()).toEqual(["e1", "e3"]);
    const r = rows[0];
    expect(r).toMatchObject({
      tenantId: "t1",
      eventType: "system.test",
      category: "system",
      status: "pending",
    });
    expect(r.payload).toMatchObject({
      event: "system.test",
      category: "system",
      tenantId: "t1",
      recipientUserIds: ["u1", "u2"],
      occurredAt: "2026-06-29T00:00:00.000Z",
    });
  });

  test("skips non-active endpoints", () => {
    const rows = buildWebhookDeliveries(
      [ep({ id: "e1", status: "disabled" }), ep({ id: "e2", status: "auto_disabled" })],
      event,
    );
    expect(rows).toHaveLength(0);
  });

  test("tolerates null/empty categories (no subscription → no row)", () => {
    const rows = buildWebhookDeliveries([ep({ id: "e1", categories: null })], event);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-dispatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/modules/notifications/src/lib/webhook-dispatch.ts

/** The subset of a notification_webhook row this helper reads. */
export interface WebhookEndpointRow {
  id: string;
  status: string; // active | disabled | auto_disabled
  categories: unknown; // jsonb — expected string[] | null
}

/** The logical event being dispatched (built once per notify() call). */
export interface WebhookEvent {
  tenantId: string;
  eventType: string;
  category: string;
  recipientUserIds: string[];
  data: Record<string, unknown> | null;
  occurredAt: string; // ISO8601
}

/** Insert-shaped delivery row (status pending) for one matching endpoint. */
export interface WebhookDeliveryValues {
  tenantId: string;
  webhookId: string;
  eventType: string;
  category: string;
  payload: Record<string, unknown>;
  status: "pending";
}

function subscribes(categories: unknown, category: string): boolean {
  return Array.isArray(categories) && categories.includes(category);
}

/**
 * Pure eligibility + payload builder: given the tenant's endpoints and the
 * event, return the delivery-row values for each ACTIVE endpoint SUBSCRIBED to
 * the event's category. The same envelope object is embedded as `payload` on
 * every row (it is what gets POSTed + signed).
 */
export function buildWebhookDeliveries(
  endpoints: WebhookEndpointRow[],
  event: WebhookEvent,
): WebhookDeliveryValues[] {
  const envelope = {
    event: event.eventType,
    category: event.category,
    tenantId: event.tenantId,
    recipientUserIds: event.recipientUserIds,
    data: event.data,
    occurredAt: event.occurredAt,
  };
  return endpoints
    .filter((e) => e.status === "active" && subscribes(e.categories, event.category))
    .map((e) => ({
      tenantId: event.tenantId,
      webhookId: e.id,
      eventType: event.eventType,
      category: event.category,
      payload: envelope,
      status: "pending" as const,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/lib/webhook-dispatch.ts packages/modules/notifications/src/lib/__tests__/webhook-dispatch.test.ts
git commit -m "feat(notifications): pure webhook eligibility + envelope builder"
```

---

## Task 9: Webhook delivery worker (`deliver-webhook.ts`)

**Files:**
- Create: `packages/modules/notifications/src/jobs/deliver-webhook.ts`
- Test: `packages/modules/notifications/src/jobs/__tests__/deliver-webhook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/jobs/__tests__/deliver-webhook.test.ts
import { describe, expect, test } from "bun:test";
import { notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { deliverWebhook, WEBHOOK_AUTO_DISABLE_THRESHOLD } from "../deliver-webhook";

type Row = Record<string, unknown>;

/**
 * Fake db: serves a delivery row + endpoint row by table, and captures
 * `.update(table).set(payload)` calls as { table, payload }.
 */
function fakeDb(opts: {
  delivery?: Row;
  endpoint?: Row;
  onUpdate: (u: { table: unknown; payload: Row }) => void;
}) {
  let from: unknown;
  let updTable: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: drizzle-shaped test double
  const db: any = {
    select: () => db,
    from: (t: unknown) => {
      from = t;
      return db;
    },
    where: () => db,
    limit: () => {
      if (from === notificationWebhookDelivery) return Promise.resolve(opts.delivery ? [opts.delivery] : []);
      if (from === notificationWebhook) return Promise.resolve(opts.endpoint ? [opts.endpoint] : []);
      return Promise.resolve([]);
    },
    update: (t: unknown) => {
      updTable = t;
      return db;
    },
    set: (payload: Row) => {
      opts.onUpdate({ table: updTable, payload });
      return db;
    },
  };
  return db;
}

const baseDelivery = { id: "d1", webhookId: "e1", attempts: "0", payload: { event: "system.test" } };
const baseEndpoint = { id: "e1", url: "https://hook.example/x", secret: "s", status: "active", consecutiveFailures: "0" };
const okLookup = async () => [{ address: "93.184.216.34" }];

function updatesFor(table: unknown, calls: Array<{ table: unknown; payload: Row }>) {
  return calls.filter((c) => c.table === table).map((c) => c.payload);
}

describe("deliverWebhook", () => {
  test("2xx → delivery success + endpoint failures reset", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery },
      endpoint: { ...baseEndpoint, consecutiveFailures: "4" },
      onUpdate: (u) => calls.push(u),
    });
    await deliverWebhook(
      { kind: "webhook-event", deliveryId: "d1" },
      { db: () => db, httpPost: async () => ({ status: 200 }), lookup: okLookup, now: () => 1_700_000_000_000 },
    );
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({ status: "success", httpStatus: "200" });
    expect(updatesFor(notificationWebhook, calls)[0]).toMatchObject({ consecutiveFailures: "0", lastStatus: "success" });
  });

  test("inactive endpoint → delivery skipped, no POST", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    let posted = false;
    const db = fakeDb({
      delivery: { ...baseDelivery },
      endpoint: { ...baseEndpoint, status: "auto_disabled" },
      onUpdate: (u) => calls.push(u),
    });
    await deliverWebhook(
      { kind: "webhook-event", deliveryId: "d1" },
      { db: () => db, httpPost: async () => { posted = true; return { status: 200 }; }, lookup: okLookup },
    );
    expect(posted).toBe(false);
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({ status: "skipped" });
  });

  test("non-2xx → records failed + throws (for BullMQ retry)", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({ delivery: { ...baseDelivery }, endpoint: { ...baseEndpoint }, onUpdate: (u) => calls.push(u) });
    const run = deliverWebhook(
      { kind: "webhook-event", deliveryId: "d1" },
      { db: () => db, httpPost: async () => ({ status: 500 }), lookup: okLookup },
    );
    await expect(run).rejects.toThrow();
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({ status: "failed", httpStatus: "500", attempts: "1" });
  });

  test("final attempt failure → bumps endpoint consecutiveFailures", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery, attempts: "2" }, // this is attempt #3 (== max)
      endpoint: { ...baseEndpoint, consecutiveFailures: "0" },
      onUpdate: (u) => calls.push(u),
    });
    await expect(
      deliverWebhook(
        { kind: "webhook-event", deliveryId: "d1" },
        { db: () => db, httpPost: async () => ({ status: 500 }), lookup: okLookup },
      ),
    ).rejects.toThrow();
    expect(updatesFor(notificationWebhook, calls)[0]).toMatchObject({ consecutiveFailures: "1", lastStatus: "failed" });
  });

  test("auto-disables at the threshold of consecutive failures", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    const db = fakeDb({
      delivery: { ...baseDelivery, attempts: "2" },
      endpoint: { ...baseEndpoint, consecutiveFailures: String(WEBHOOK_AUTO_DISABLE_THRESHOLD - 1) },
      onUpdate: (u) => calls.push(u),
    });
    await expect(
      deliverWebhook(
        { kind: "webhook-event", deliveryId: "d1" },
        { db: () => db, httpPost: async () => ({ status: 500 }), lookup: okLookup },
      ),
    ).rejects.toThrow();
    expect(updatesFor(notificationWebhook, calls)[0]).toMatchObject({
      status: "auto_disabled",
      consecutiveFailures: String(WEBHOOK_AUTO_DISABLE_THRESHOLD),
    });
  });

  test("SSRF rejection at delivery time → failed, no POST", async () => {
    const calls: Array<{ table: unknown; payload: Row }> = [];
    let posted = false;
    const db = fakeDb({ delivery: { ...baseDelivery }, endpoint: { ...baseEndpoint }, onUpdate: (u) => calls.push(u) });
    await expect(
      deliverWebhook(
        { kind: "webhook-event", deliveryId: "d1" },
        {
          db: () => db,
          httpPost: async () => { posted = true; return { status: 200 }; },
          lookup: async () => [{ address: "169.254.169.254" }],
        },
      ),
    ).rejects.toThrow();
    expect(posted).toBe(false);
    expect(updatesFor(notificationWebhookDelivery, calls)[0]).toMatchObject({ status: "failed" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/jobs/__tests__/deliver-webhook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
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
  httpPost: (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number }>;
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
      const patch: any = { consecutiveFailures: String(failures), lastStatus: "failed", lastDeliveryAt: new Date() };
      if (failures >= WEBHOOK_AUTO_DISABLE_THRESHOLD) {
        patch.status = "auto_disabled";
        patch.disabledReason = `${failures} consecutive failures`;
        logger.warn({ webhookId: endpoint.id, failures }, "webhook endpoint auto-disabled");
      }
      await db.update(notificationWebhook).set(patch).where(eq(notificationWebhook.id, endpoint.id));
    }
  };

  let res: { status: number };
  try {
    await assertSafeWebhookUrl(endpoint.url, { lookup: deps.lookup });
    const ts = Math.floor(now() / 1000);
    const signature = signWebhook(endpoint.secret, body, ts);
    res = await httpPost(endpoint.url, {
      "content-type": "application/json",
      "X-Baseworks-Signature": signature,
    }, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordFailure(message, null);
    throw err; // BullMQ retry
  }

  if (res.status >= 200 && res.status < 300) {
    await db
      .update(notificationWebhookDelivery)
      .set({ status: "success", httpStatus: String(res.status), attempts: String(attempt), deliveredAt: new Date(), lastError: null })
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/jobs/__tests__/deliver-webhook.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/jobs/deliver-webhook.ts packages/modules/notifications/src/jobs/__tests__/deliver-webhook.test.ts
git commit -m "feat(notifications): webhook delivery worker (sign, SSRF, retry, auto-disable)"
```

---

## Task 10: Retention prune job

**Files:**
- Create: `packages/modules/notifications/src/jobs/prune-webhook-deliveries.ts`
- Test: `packages/modules/notifications/src/jobs/__tests__/prune-webhook-deliveries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/jobs/__tests__/prune-webhook-deliveries.test.ts
import { describe, expect, test } from "bun:test";
import { notificationWebhookDelivery } from "@baseworks/db";
import { pruneWebhookDeliveries } from "../prune-webhook-deliveries";

describe("pruneWebhookDeliveries", () => {
  test("deletes from the delivery table with a cutoff = now - retentionDays", async () => {
    let deletedFrom: unknown;
    let whereCalled = false;
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-shaped test double
    const db: any = {
      delete: (t: unknown) => {
        deletedFrom = t;
        return { where: () => { whereCalled = true; return Promise.resolve(); } };
      },
    };

    await pruneWebhookDeliveries(undefined, {
      db: () => db,
      retentionDays: 30,
      now: () => new Date("2026-06-29T00:00:00.000Z").getTime(),
    });

    expect(deletedFrom).toBe(notificationWebhookDelivery);
    expect(whereCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/jobs/__tests__/prune-webhook-deliveries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/modules/notifications/src/jobs/prune-webhook-deliveries.ts
import { env } from "@baseworks/config";
import { getDb, notificationWebhookDelivery } from "@baseworks/db";
import { lt } from "drizzle-orm";
import pino from "pino";

const logger = pino({ name: "notifications-webhook-prune" });

export interface PruneDeps {
  // biome-ignore lint/suspicious/noExplicitAny: owner Drizzle client (worker maintenance)
  db: () => any;
  retentionDays: number;
  now: () => number;
}

const defaultDeps: PruneDeps = {
  db: () => getDb(env.DATABASE_URL),
  retentionDays: env.WEBHOOK_DELIVERY_RETENTION_DAYS,
  now: () => Date.now(),
};

/**
 * Daily maintenance: delete notification_webhook_delivery rows older than the
 * retention window. Owner db (cross-tenant maintenance — bypasses RLS by design).
 */
export async function pruneWebhookDeliveries(
  _payload: unknown,
  deps: Partial<PruneDeps> = {},
): Promise<void> {
  const db = (deps.db ?? defaultDeps.db)();
  const retentionDays = deps.retentionDays ?? defaultDeps.retentionDays;
  const now = deps.now ?? defaultDeps.now;

  const cutoff = new Date(now() - retentionDays * 24 * 60 * 60 * 1000);
  await db.delete(notificationWebhookDelivery).where(lt(notificationWebhookDelivery.createdAt, cutoff));
  logger.info({ cutoff: cutoff.toISOString(), retentionDays }, "pruned webhook delivery rows");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/jobs/__tests__/prune-webhook-deliveries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/jobs/prune-webhook-deliveries.ts packages/modules/notifications/src/jobs/__tests__/prune-webhook-deliveries.test.ts
git commit -m "feat(notifications): daily webhook-delivery retention prune job"
```

---

## Task 11: Dispatch webhooks from `notify()`

**Files:**
- Modify: `packages/modules/notifications/src/commands/notify.ts`
- Test: `packages/modules/notifications/src/__integration__/notify-webhook.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/modules/notifications/src/__integration__/notify-webhook.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notification, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { notify } from "../commands/notify";
import { makeCtx } from "./_ctx";

const T = "notif-webhook-it-tenant";
let ok = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    // Seed one active endpoint subscribed to the "system" category.
    await getDb()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: minimal seed insert
      .values({ tenantId: T, url: "https://hook.example/x", secret: "s", categories: ["system"], status: "active" } as any);
    ok = true;
  } catch {
    ok = false;
  }
});
afterAll(async () => {
  if (!ok) return;
  await getDb().delete(notificationWebhookDelivery).where(eq(notificationWebhookDelivery.tenantId, T));
  await getDb().delete(notificationWebhook).where(eq(notificationWebhook.tenantId, T));
  await getDb().delete(notification).where(eq(notification.tenantId, T));
});

describe("notify() webhook dispatch", () => {
  test("creates one pending webhook delivery per matching endpoint, once per event", async () => {
    if (!ok) return console.warn("SKIPPED");
    // Two recipients → 2 notification rows, but webhooks fire ONCE per event.
    const res = await notify(
      { type: "system.test", recipients: { userIds: ["u1", "u2"] }, data: { message: "hi" } },
      makeCtx(T, "u1"),
    );
    expect(res.success).toBe(true);

    const deliveries = await getDb()
      .select()
      .from(notificationWebhookDelivery)
      .where(eq(notificationWebhookDelivery.tenantId, T));
    expect(deliveries).toHaveLength(1); // once per event, not per recipient
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].eventType).toBe("system.test");
    expect((deliveries[0].payload as { recipientUserIds: string[] }).recipientUserIds).toEqual(["u1", "u2"]);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/__integration__/notify-webhook.test.ts`
Expected: FAIL — `notify()` does not create webhook delivery rows yet (or SKIPPED if no `DATABASE_URL_RLS`; if SKIPPED, proceed — Step 4's unit coverage in Task 8 plus typecheck gate this task).

- [ ] **Step 3: Add the dispatch block to `notify()`**

In `packages/modules/notifications/src/commands/notify.ts`:

3a. Update imports. `notify.ts` already imports `eq` from `drizzle-orm` and `getDeliverQueue` from `../lib/deliver-queue` (Phase 3) — do NOT re-add those. Changes:

- Extend the existing `@baseworks/db` import to add `notificationWebhook` and `notificationWebhookDelivery`. Final form:
  ```ts
  import { notification, notificationDelivery, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
  ```
- Extend the existing drizzle import to add `and`:
  ```ts
  import { and, eq } from "drizzle-orm";
  ```
- Add the two new helper imports (alongside the existing `getDeliverQueue` import):
  ```ts
  import { buildWebhookDeliveries } from "../lib/webhook-dispatch";
  import { getWebhookQueue } from "../lib/webhook-queue";
  ```

3b. Immediately AFTER the existing channel-delivery enqueue block (the `const queue = getDeliverQueue(); if (channelJobs.length > 0 && queue) { ... }`) and BEFORE the `ctx.emit(...)` line, insert:

```ts
  // Webhook fan-out — ONCE per event (not per recipient). Eligible endpoints are
  // this tenant's active endpoints subscribed to the notification's category,
  // unless the catalog entry opts out via `webhookable: false`.
  if (entry.webhookable !== false) {
    const deliveryIds = await requireWithTenant(ctx)(async (tx) => {
      const endpoints = await tx
        .select()
        .from(notificationWebhook)
        .where(
          and(
            eq(notificationWebhook.tenantId, ctx.tenantId),
            eq(notificationWebhook.status, "active"),
          ),
        );
      const rows = buildWebhookDeliveries(endpoints, {
        tenantId: ctx.tenantId,
        eventType: input.type,
        category: entry.category,
        recipientUserIds: recipients,
        data: input.data ?? null,
        occurredAt: new Date().toISOString(),
      });
      const ids: string[] = [];
      for (const values of rows) {
        // biome-ignore lint/suspicious/noExplicitAny: insert values are validated by buildWebhookDeliveries
        const [row] = await tx.insert(notificationWebhookDelivery).values(values as any).returning();
        ids.push(row.id);
      }
      return ids;
    });

    const webhookQueue = getWebhookQueue();
    if (deliveryIds.length > 0 && webhookQueue) {
      await Promise.all(
        deliveryIds.map((deliveryId) =>
          webhookQueue.add("webhook-event", { kind: "webhook-event", deliveryId }),
        ),
      );
    }
  }
```

(`recipients` is the resolved `string[]` of user ids already computed earlier in `notify()`. `entry` is the catalog entry already in scope.)

- [ ] **Step 4: Run the integration test (and typecheck)**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun test packages/modules/notifications/src/__integration__/notify-webhook.test.ts`
Expected: PASS if `DATABASE_URL_RLS` is set; otherwise "SKIPPED" (acceptable — Task 8 unit-covers eligibility/envelope).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/commands/notify.ts packages/modules/notifications/src/__integration__/notify-webhook.test.ts
git commit -m "feat(notifications): dispatch webhooks once-per-event from notify()"
```

---

## Task 12: Register the two jobs + final verification

**Files:**
- Modify: `packages/modules/notifications/src/index.ts`

- [ ] **Step 1: Register the worker + prune jobs**

In `packages/modules/notifications/src/index.ts`:

1a. Add imports:

```ts
import { deliverWebhook } from "./jobs/deliver-webhook";
import { pruneWebhookDeliveries } from "./jobs/prune-webhook-deliveries";
```

1b. Add to the `jobs` map (next to the existing `notifications-deliver` entry):

```ts
    "notifications-webhook": {
      queue: "notifications-webhook",
      handler: deliverWebhook,
      concurrency: 20,
    },
    "notifications-webhook-prune": {
      queue: "notifications-webhook-prune",
      handler: pruneWebhookDeliveries,
      repeat: { pattern: "0 3 * * *" }, // daily at 03:00
    },
```

(The worker boot loop in `apps/api/src/worker.ts` already iterates `def.jobs`, honors `concurrency`, and registers `repeat.pattern` via `upsertJobScheduler` — no worker edits needed. `notifications` is already in the worker's module list.)

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Run the full notifications unit suite (per-suite isolation)**

Run: `bun test packages/modules/notifications`
Expected: PASS — existing tests plus the new signature/security/dispatch/deliver-webhook/prune suites. Integration suites SKIP without `DATABASE_URL_RLS`.

- [ ] **Step 4: Biome + cross-module lint**

Run: `bunx biome check packages/modules/notifications/src`
Expected: clean (only pre-existing `any` warnings, consistent with the module).
Run: `bun run lint:cross-module`
Expected: clean (producers reference the queue by name; no cross-module import).

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/index.ts
git commit -m "feat(notifications): register notifications-webhook worker + daily prune job"
```

---

## Self-Review Notes (for the implementer)

- **`WEBHOOK_MAX_ATTEMPTS` (3) MUST equal the queue's `attempts` default** (`packages/queue/src/index.ts` → `DEFAULT_JOB_OPTIONS.attempts`). If that default ever changes, the auto-disable "final attempt" detection in `deliver-webhook.ts` drifts. They are coupled by design; a comment in the file flags it.
- **SSRF runs twice** — at registration (4b) and at delivery (here). 4a only wires delivery-time; registration-time validation lands with `createWebhook` in 4b (the `assertSafeWebhookUrl` helper is already built and reused).
- **Per-suite test isolation** (project convention): the new unit suites are DB/Redis-free and safe to run together; the integration suite gates on `DATABASE_URL_RLS`.
- **Deferred to later plans:** endpoint CRUD + delivery-history + redeliver API (4b); web UI (4c); admin UI (4d). The `redeliver` feature relies on the stored `payload` column added here.
