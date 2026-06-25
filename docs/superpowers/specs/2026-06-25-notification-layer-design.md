# Notification Layer — Design Spec

**Status:** approved (brainstorm 2026-06-25) — ready for implementation planning
**Author:** brainstorming session
**Scope:** one cohesive module/subsystem (the implementation plan will phase it)

## Goal

A strong, generic, multitenant notification layer for the Baseworks SaaS/freelance starter kit: multi-channel delivery (email, in-app, webhook — pluggable), a generic notification shape that supports navigation *and* executable actions, per-user preferences, BullMQ-backed delivery, SSE for in-app realtime — built on the existing module + CQRS + Elysia/Eden + Drizzle + better-auth + Postgres-RLS architecture, and consolidating the ad-hoc email pipeline that currently lives in the billing module.

## Decisions (from brainstorm)

| # | Decision | Choice |
|---|----------|--------|
| Channels | what to deliver through | **Email + In-app + Webhook**, behind a pluggable `ChannelAdapter` port (SMS/push later) |
| Trigger | how modules fire notifications | **Both** — explicit `notify()` CQRS command is the canonical engine; a thin `subscriptions.ts` maps domain events → `notify()` for reactive/cross-cutting cases |
| In-app transport | browser delivery | **SSE** (Server-Sent Events) over a Redis pub/sub fan-out (reuses the BullMQ Redis); DB table is source of truth. WebSocket deferred to later bidirectional features |
| Shape | notification payload | generic: `type, severity, title, body, url, actions[], data` |
| Actions | richness | **link + dispatch** — `link` (navigate) and `dispatch` (execute a server-authored CQRS command directly), both built now |

## Architecture (Approach A — dedicated module, channel-adapter pattern)

A new Medusa-style module `packages/modules/notifications/`, registered in both the api and worker roles (like `files`). `notify()` persists a tenant-scoped `notification` row (the canonical record **and** the in-app feed item), resolves recipient preferences against a typed catalog, then delivers per channel: in-app **inline** (write + Redis publish → SSE), email/webhook **enqueued** to a BullMQ `notifications-deliver` queue consumed by the worker. All channels implement one `ChannelAdapter` port.

Rejected alternatives: a shared `packages/notifications` library (bypasses CQRS/RLS conventions, tighter coupling); an external provider like Knock/Novu (vendor lock-in, against the self-hosted ethos, doesn't ride the RLS model).

## Module layout

```
packages/modules/notifications/src/
  index.ts            # ModuleDefinition: commands, queries, jobs, events, routes, subscriptions
  commands/
    notify.ts                 # core engine — tenant-scoped, multi-channel
    send-transactional-email.ts  # to an arbitrary address, no tenant/feed (auth flows, invites)
    mark-read.ts  mark-all-read.ts
    execute-action.ts         # run a stored dispatch action
    update-preferences.ts
    register-webhook.ts
  queries/
    list-notifications.ts  unread-count.ts  get-preferences.ts
  channels/
    channel.ts          # ChannelAdapter port
    in-app.ts  email.ts  webhook.ts
  jobs/deliver.ts       # BullMQ worker handler (email/webhook)
  catalog.ts            # typed notification-type catalog
  lib/
    render.ts  preferences.ts  webhook-sign.ts  recipients.ts
  templates/            # React-Email templates (moved from billing) + new ones
  sse/index.ts          # SSE endpoint + Redis pub/sub bridge
  routes.ts             # HTTP surface (list, unread-count, mark-read, execute, preferences, stream, webhook mgmt)
  subscriptions.ts      # domain-event → notify() mapping
```

Schema lives in `packages/db/src/schema/notifications.ts` (repo convention: schema in `@baseworks/db`).

## Data model (Drizzle; every table `tenantIdColumn()` → RLS policy via `tenantRlsPolicy`, satisfying the `lint:rls-coverage` guard)

- **`notification`** — `id, tenant_id, recipient_user_id, type, category, severity (info|success|warning|error), title, body, url?, data jsonb, actions jsonb, group_key?, read_at?, created_at`. Canonical record + in-app feed item.
- **`notification_delivery`** — `id, tenant_id, notification_id (fk), channel, status (pending|sent|failed|skipped), provider_message_id?, error?, attempts, created_at, updated_at`. Per-channel delivery audit.
- **`notification_preference`** — `id, tenant_id, user_id, category, channel, enabled`. Unique on `(tenant_id, user_id, category, channel)`. Per-user opt-out; absence = catalog default.
- **`notification_webhook`** — `id, tenant_id, url, secret, categories jsonb, enabled, created_at`. Tenant's outbound webhook endpoints.
- **`notification_action_execution`** — `id, tenant_id, notification_id, action_id, executed_by, executed_at, result jsonb`. Unique on `(notification_id, action_id)` for `once` idempotency + audit.

**Isolation:** RLS enforces the *tenant* boundary on all tables. Per-recipient visibility within a tenant (a member must not see another member's notifications) is an **app-level predicate** `recipient_user_id = ctx.userId` on list/stream/mark-read/execute — consistent with the codebase (RLS is tenant-scoped, not per-user).

## Notification shape

```ts
interface Notification {
  id: string; tenantId: string; recipientUserId: string;
  type: string;                 // catalog key, e.g. "billing.payment_failed"
  category: string;             // e.g. "billing" | "team" | "files" | "security" | "system"
  severity: "info" | "success" | "warning" | "error";
  title: string; body: string;  // channel-agnostic semantic content
  url?: string;                 // primary navigation (relative app route)
  actions?: Action[];           // server-authored
  data?: Record<string, unknown>; // generic escape hatch (entity ids, etc.) for templates/webhooks/deep-links
  groupKey?: string;            // dedup/grouping
  readAt?: string; createdAt: string;
}

type Action =
  | { id: string; label: string; kind: "link";     url: string;               style?: "primary" | "default" | "destructive" }
  | { id: string; label: string; kind: "dispatch"; command: string; input: unknown; once?: boolean; style?: "primary" | "default" | "destructive" };
```

Per-channel rendering/degradation: **in-app** renders real action buttons; **email** renders `link` actions as CTA buttons and `dispatch` actions as a link into the app (a mutating click from an email body isn't safe); **webhook** ships the structured JSON (`type, category, severity, title, body, url, data, actions`).

## Two entry points

Not everything fits "notify a member in a tenant": password-reset / magic-link / email-verification run with **no tenant context**, and invites target an **email that isn't a member yet**.

- **`notify(input)`** — tenant-scoped; `recipients: { userIds?: string[]; role?: "owner"|"admin"|"member" }` resolved to tenant members; multi-channel; full feed/preferences/actions. For events targeting existing members (billing, files, team).
- **`sendTransactionalEmail(input)`** — to an arbitrary email address, no tenant/feed; reuses the **same email adapter + provider + templates**. For auth flows + invites.

Both share one email integration; only `notify()` carries the rich tenant-notification model.

## Delivery pipeline

1. `notify(input)` (dispatched directly, or from `subscriptions.ts`): tenantId/userId from `HandlerContext`.
2. Resolve recipients (`recipients.ts`): explicit `userIds` and/or `role` → member user ids (via auth `member` table, through `ctx.dispatch`/a query — no cross-module import).
3. `catalog[type]` → `category, severity, defaultChannels, render(data)` → `{ title, body, url?, actions? }`.
4. For each recipient: create the `notification` row; compute effective channels = `defaultChannels` minus user-disabled `(category, channel)` (unless `required`); create a `notification_delivery` row per effective channel.
5. Deliver:
   - **in-app** — inline: row already written; publish `{notification.created, id}` to Redis channel `notif:{tenantId}:{recipientUserId}`; mark delivery `sent`.
   - **email / webhook** — enqueue `{deliveryId}` to `notifications-deliver`; worker `deliver.ts` loads delivery+notification, invokes the channel adapter, updates status; BullMQ provides retry/backoff.

`ChannelAdapter` port: `deliver(notification, delivery, ctx): Promise<DeliveryResult>`. Adding SMS/push later = new adapter + a catalog channel value.

## Channel adapters

- **in-app** — write/confirm row + Redis publish → SSE. (No external I/O; runs inline.) The `notification` row is *always* created (canonical record/audit), but it only becomes an in-app **delivery** (and thus appears in the feed) when the in-app channel is effective for that recipient; the feed/unread queries list notifications that have an in-app delivery. So disabling the in-app channel suppresses the feed item without losing the record or other channels.
- **email** — render the type's React-Email template (channel="email" variant) with `data` + locale (existing `getLocale`/i18n); send via an `EmailProvider` port (Resend impl now, pluggable). Records `provider_message_id`.
- **webhook** — for each enabled `notification_webhook` whose `categories` include the notification's category: POST the structured JSON with an HMAC-SHA256 signature header (`webhook-sign.ts`, secret per endpoint); retries/backoff via BullMQ; records status per endpoint.

## Action execute flow (security)

`POST /api/notifications/:id/actions/:actionId/execute` → auth + tenant middleware →
1. Load notification (RLS scopes to tenant); 404 if absent.
2. Assert `recipient_user_id === ctx.userId` → else 403.
3. Find the action by `actionId` in the stored `actions` (server-authored at `notify()` time, immutable).
4. `link` → not executable here (client navigates); return 400.
5. `dispatch` → if `once` and a `notification_action_execution` exists → return the prior result (idempotent). Else `ctx.dispatch(action.command, action.input)` — the command re-runs its **own** permission + validation (e.g. `auth:accept-invitation` checks the invite is the caller's). Record `notification_action_execution` (result). Optionally mark the notification read.

The client supplies only `:id`/`:actionId`; `command`+`input` come from the stored, server-authored action — no client tampering, no arbitrary endpoint access.

## SSE

`GET /api/notifications/stream` behind auth+tenant middleware. One shared ioredis **subscriber** connection per process (pub/sub monopolizes a connection); a refcounted registry subscribes/unsubscribes the per-user channel `notif:{tenantId}:{userId}` and routes published payloads to that user's open stream(s). Each stream: send an initial comment, forward `notification.created` events as SSE `data:` lines, periodic keep-alive comments, cleanup (decref/unsubscribe) on disconnect. Multi-instance correct via Redis pub/sub.

Web client: an `EventSource`-backed hook that, on message, invalidates the notifications React-Query cache and bumps the unread badge. UI: a bell + unread count, a notification feed (list/mark-read/act), and a preferences page (category × channel toggles).

## Email migration (out of billing)

- Move `packages/modules/billing/src/templates/*` (`welcome`, `password-reset`, `team-invite`, `billing-notification`) and `jobs/send-email.ts` into `notifications` (`templates/`, email adapter).
- Retire the ad-hoc `email-send` queue; deliveries flow through `notifications-deliver` (and `sendTransactionalEmail()` for address-only sends).
- Repoint producers: auth `better-auth` hooks (reset/magic-link/verify) + invite emails → `sendTransactionalEmail()`; billing/file/team member-facing events → `notify()`.
- Preserve behavior + locale-awareness; keep existing auth/billing email tests green (adapt to the new path).

## Testing

- **Unit:** catalog render per type; preference resolution (defaults, opt-out, `required` override); webhook HMAC signing; per-channel action degradation; action authorization (recipient check, command dispatch, `once` idempotency).
- **Integration (live DB + RLS):** `notify()` creates tenant-scoped `notification` + `notification_delivery` rows; RLS tenant isolation + per-recipient app-predicate isolation; full HTTP flow `notify → list → unread-count → mark-read → execute-action` under the RLS role.
- **Adapters:** email (mock `EmailProvider`), webhook (mock HTTP + signature verify), in-app (assert Redis publish).
- **SSE:** a focused publish→receive test (subscriber registry routes to the right stream).

## Scope / YAGNI

**In v1:** the module; 5 tables + RLS; `notify` + `sendTransactionalEmail`; in-app + email + webhook adapters; SSE; typed catalog; per-`category` preferences; `link` + `dispatch` actions + execute endpoint; web bell + feed + preferences page; billing-email migration.

**Deferred (port-ready, do not build now):** SMS/push adapters; WebSocket transport; digest/batching/scheduled summaries; per-`type` preference granularity; admin-app notification view; localization beyond the existing i18n/locale path.

## Suggested implementation phasing (for the plan)

1. **Schema + module skeleton** — 5 tables + RLS policies + lint:rls-coverage; `ChannelAdapter` port; catalog scaffold; module registration (api+worker).
2. **`notify()` + in-app + SSE** — engine, recipient resolution, in-app adapter, Redis publish, SSE endpoint, web bell/feed + EventSource hook.
3. **Email channel + migration** — `EmailProvider` port (Resend), templates moved from billing, `sendTransactionalEmail`, repoint auth/billing producers, `notifications-deliver` worker.
4. **Webhook channel** — endpoints CRUD, HMAC signing, delivery + retries.
5. **Actions** — `dispatch` execute endpoint + idempotency + audit; in-app action buttons.
6. **Preferences** — resolution wired through `notify()`, prefs query/command, web preferences page.

Each phase produces working, tested software and can ship as its own PR. Execution will use the gated multi-agent workflow pattern.
