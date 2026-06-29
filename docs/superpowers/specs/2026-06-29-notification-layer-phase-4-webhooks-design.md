# Notification Layer Phase 4 — Outbound Webhook Channel

**Date:** 2026-06-29
**Status:** Design approved — pending spec review
**Builds on:** Phase 3 (email channel + unified `notifications-deliver` queue, channel-adapter port)

## Summary

Add an outbound webhook channel so tenants can register HTTPS endpoints and
receive signed HTTP POST callbacks when notifications fire on categories they
subscribe to. Delivery is **once per logical event** (not per recipient), runs
on a **dedicated `notifications-webhook` queue/worker**, is **SSRF-hardened**
and **HMAC-signed**, and is observable through a **hybrid audit model** (in-place
Postgres delivery rows + BullMQ retention for attempt detail) with **endpoint
auto-disable** on sustained failure. Tenants self-serve in `apps/web`; platform
staff get an oversight view in `apps/admin`.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fan-out unit | **Once per event** (deduped), not per recipient | A webhook targets a *system* integration, which cares an event happened once — not once per notified human. Avoids exporting dedup to every consumer. |
| Dispatch trigger | **Inline in `notify()`** (Approach A) | Matches Phase 3's enqueue-after-commit pattern; reuses the shared rendered content; no speculative event-bus infra (YAGNI). |
| Eligibility | **Endpoint subscription**, not catalog `defaultChannels` | A notification fires webhooks if any active endpoint subscribes to its `category`. Optional catalog `webhookable: false` suppresses sensitive internal types. |
| Queue | **Dedicated `notifications-webhook`** queue + worker (~20 concurrency) | Isolates slow/flaky third-party POSTs from latency-sensitive transactional email on `notifications-deliver`. |
| SSRF | **Block private ranges + require HTTPS**, at registration AND delivery | Tenant-controlled URLs are an SSRF vector (cloud metadata, RFC1918, loopback). Validate at both ends incl. DNS resolution. |
| Signing | **HMAC-SHA256, Stripe-style** `X-Baseworks-Signature: t=<unix>,v1=<hex>` over `<t>.<body>` | Timestamp inside the signed payload gives replay protection. |
| Audit | **Hybrid**: in-place delivery rows + retention prune + endpoint health/auto-disable; BullMQ retention for per-attempt detail | Bounds Postgres cost (no row-per-attempt), keeps a tenant-facing delivery list, and BullMQ/Bull Board covers ops-level attempt history for free. |
| Auto-disable | **15 consecutive failures** (count-based) | Simple, predictable; a success resets the counter. |
| Scope | **Backend + both UIs** (web self-serve, admin oversight) | Tenants self-manage; staff get support/abuse visibility. |
| Redeliver | **In v1** | Cheap — the event `payload` is already stored on the delivery row. |
| Secret exposure | **Write-once / read-never** (shown only at create + rotate) | Matches Stripe/GitHub; never returned from reads. |

## Data Model

### `notification_webhook` (extend existing)

Existing: `id, tenantId, url, secret, categories (jsonb), enabled, timestamps`.

Changes:
- **Drop** `enabled` boolean; **add** `status text NOT NULL default 'active'` —
  one of `active | disabled | auto_disabled` (tri-state: tenant-disabled vs
  system auto-disabled vs active). Migration backfill: `enabled = true → 'active'`,
  `enabled = false → 'disabled'` (no existing rows are `auto_disabled`).
- `description text` — tenant's label.
- `consecutiveFailures text NOT NULL default '0'` — drives auto-disable (text to
  match the existing `attempts` column convention).
- `lastDeliveryAt timestamp`.
- `lastStatus text` — `success | failed`.
- `disabledReason text` — e.g. `"15 consecutive failures"`.

`secret` is generated server-side (`nanoid`), never returned from reads.

### `notification_webhook_delivery` (new)

One row per (event, endpoint), **updated in place** across retries.

```
id            (pk)
tenantId      (RLS-scoped, tenantRlsPolicy like siblings)
webhookId     text NOT NULL        -- the target endpoint
eventType     text NOT NULL        -- e.g. "billing.invoice_paid"
category      text NOT NULL
payload       jsonb NOT NULL       -- signed event envelope (enables redeliver + debugging)
status        text NOT NULL        -- pending | success | failed | skipped
httpStatus    text                 -- last response code (null on network error)
attempts      text NOT NULL '0'    -- mirrors BullMQ attemptsMade
lastError     text
deliveredAt   timestamp            -- set on success
timestamps
index (tenantId, webhookId, createdAt desc)   -- tenant-facing history list
```

Per-attempt detail is **not** persisted here — it lives in BullMQ job retention
(`removeOnComplete`/`removeOnFail` by age) and surfaces in the admin job
dashboard. Rows are pruned after `WEBHOOK_DELIVERY_RETENTION_DAYS` (default 30).

## Event Envelope

Built once per event, stored on each delivery row's `payload`, POSTed as the body:

```jsonc
{
  "event": "billing.invoice_paid",
  "category": "billing",
  "tenantId": "...",
  "recipientUserIds": ["..."],   // who it concerned, not who-to-POST
  "data": { ... },               // catalog render data
  "occurredAt": "<iso8601>"
}
```

## Dispatch Flow

### Producer — inside `notify()`, after the tenant tx commits

1. `notify()` renders shared content once and writes per-recipient `notification`
   rows (unchanged from Phase 3).
2. **Once per event:** if the catalog entry is not `webhookable: false`, load the
   tenant's `status = 'active'` endpoints whose `categories` include
   `entry.category`.
3. For each matching endpoint: insert a `notification_webhook_delivery` row
   (`status = 'pending'`, with the built envelope as `payload`) and enqueue one
   `{ kind: "webhook-event", deliveryId }` job onto **`notifications-webhook`**
   via a memoized `getWebhookQueue()` (mirrors `getDeliverQueue()`).

`occurredAt` must be passed in (scripts/handlers cannot call `Date.now()` at
module-eval; use request time) — stamp it in the command handler.

### Worker — `notifications-webhook` handler (`jobs/deliver-webhook.ts`)

1. Load delivery row + endpoint (owner db, cross-tenant/trusted). If endpoint not
   `active` → mark delivery `skipped`, return.
2. **SSRF guard (delivery-time):** require `https://`; resolve DNS; reject
   loopback / link-local / RFC1918 / `169.254.169.254`. Same validator as
   registration (`lib/webhook-security.ts`).
3. **Sign:** `HMAC-SHA256(secret, "<t>.<body>")` →
   `X-Baseworks-Signature: t=<t>,v1=<hex>` (`lib/webhook-signature.ts`). POST
   JSON with a ~10s timeout.
4. **Outcome:**
   - 2xx → delivery `success` + `deliveredAt`; endpoint `consecutiveFailures` →
     0, `lastStatus = 'success'`, `lastDeliveryAt` set.
   - non-2xx / timeout / network / SSRF-reject → update delivery
     (`attempts`, `httpStatus`, `lastError`) and **throw** so BullMQ retries
     (queue default: 3 attempts, exponential backoff).
5. **Auto-disable:** on final (retry-exhausted) failure, increment endpoint
   `consecutiveFailures`; at ≥ 15 set `status = 'auto_disabled'` +
   `disabledReason`. A success resets the counter.

Signing and SSRF live in small dedicated, unit-testable helpers.

## Endpoint Management API

`defineCommand`/query handlers, RLS-scoped via `requireWithTenant`, mounted under
`/api/notifications/webhooks` (Eden Treaty typed). TypeBox-validated inputs.

| Operation | Handler | Notes |
|-----------|---------|-------|
| Create | `createWebhook` | URL through SSRF guard; `categories ⊆` known set; generates `secret`, returned **once**. |
| List | `listWebhooks` | Tenant's endpoints; secret omitted. |
| Update | `updateWebhook` | Edit url/categories/description/status; re-validate URL; tenant re-enable of `auto_disabled` resets `consecutiveFailures`. |
| Delete | `deleteWebhook` | Removes endpoint; delivery rows cascade/prune. |
| Rotate secret | `rotateWebhookSecret` | New secret returned **once**. |
| Delivery history | `listWebhookDeliveries` | Paginated; filter by webhookId/status. |
| Redeliver | `redeliverWebhook` | Re-enqueue a past delivery from stored `payload`. |

Secret is **write-once / read-never** after creation/rotation.

## Retention Prune Job

A daily `repeat` BullMQ job registered in the module's `jobs`, deletes
`notification_webhook_delivery` rows older than `WEBHOOK_DELIVERY_RETENTION_DAYS`
(default 30). Owner db (cross-tenant maintenance), logged. Keeps audit cost flat.

## UIs

### `apps/web` — tenant self-serve (`/settings/webhooks`, Next.js + shadcn)

- Endpoints table: url, categories, status badge (active / disabled /
  auto-disabled), last delivery.
- Create/edit dialog (react-hook-form + zod): url, category multi-select,
  description. Secret shown **once** in a copy-once panel on create/rotate.
- Endpoint detail: paginated delivery history (status / code / time),
  **Redeliver** per row, **Re-enable** for auto-disabled, **Rotate secret**.
- Data via Eden Treaty + React Query.

### `apps/admin` — platform oversight (Vite + React Router)

- Read-mostly cross-tenant view: search/filter webhooks by tenant, status +
  recent failure rates, drill into a tenant's delivery history for support.
- Mutations limited to force-disable (abuse response).
- Cross-tenant reads go through the **existing platform-admin authorization
  band** (no tenant RLS filter) — no new mechanism.

## Testing

- **Unit:** SSRF validator (loopback / link-local / RFC1918 / metadata / DNS
  cases); HMAC signature (known vector + replay timestamp); auto-disable counter;
  eligibility matching (category ⊆ subscription, `webhookable:false` suppression).
- **Worker (injected deps, no network):** `webhook-event` branch — success resets
  failures, non-2xx throws→retry, exhausted retries auto-disable, inactive
  endpoint skips. Fake HTTP client + fake db (Phase 3 pattern).
- **Command/integration (real db):** CRUD + RLS isolation (tenant A cannot see
  tenant B's endpoints), secret write-once, redeliver re-enqueues.
- **Per-suite isolation** per the project convention (separate `bun test`
  invocations; wired into the root `test` script).

## Out of Scope

- Producer-agnostic event-bus dispatch (Approach B) — revisit if a second
  non-`notify()` producer appears.
- Outbox/transactional dispatch (Approach C) — BullMQ retries suffice once enqueued.
- Per-attempt Postgres history — BullMQ retention covers ops.
- Webhook payload schemas per event type / consumer SDK — future.

## New Config

- `WEBHOOK_DELIVERY_RETENTION_DAYS` (default 30)
- Auto-disable threshold (default 15) — constant, promote to config only if needed.
- Webhook worker concurrency (default ~20).
