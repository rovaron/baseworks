# Notification Preferences — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorming) → ready for implementation plan
**Module:** `packages/modules/notifications`, `apps/web`

## Problem

The `notification_preference` table exists but is dead: `notify()` reads nothing
from it, there is no CRUD API, and no UI. Users cannot control which
notifications reach them. This wires the table end-to-end so users can mute
email per category, `notify()` enforces those choices, and a settings panel
manages them.

## Scope

Per-user notification preferences that gate the **email** channel per category,
enforced in `notify()`, with a read/write API and a settings-page UI.

**In scope**

- Enforce email opt-outs in `notify()`'s per-recipient loop.
- `GET /api/notifications/preferences` (effective matrix) + `PUT
  /api/notifications/preferences` (upsert opt-outs).
- "Notifications" tab in `dashboard/settings` with a category × email toggle list.

**Out of scope (explicit)**

- Tenant-admin default preferences (the table is `userId NOT NULL`; tenant-wide
  defaults need a schema change — future extension).
- Muting **in-app** (the canonical feed row is always created) or **webhook**
  (tenant/endpoint-level, already filtered by each endpoint's `categories`).
- Push/SMS channels (the `channel` column stays open for them; only `email` is
  wired now).
- Digest/scheduling/quiet-hours.

## Key decisions

1. **Email-only control.** In-app is always delivered (the `notification` row is
   the feed item and the canonical record — never dropped). Preferences gate only
   the async per-recipient email job. Webhooks are unaffected.
2. **Absence = default (opt-out storage).** A missing row means "email enabled"
   (catalog default). Only choices are stored; `enabled=true` and `enabled=false`
   rows are both persisted (clean `updatedAt`/audit), but the *effective* default
   for an absent row is enabled.
3. **Required types bypass preferences.** If a catalog entry has `required: true`,
   its email always sends regardless of any opt-out (security/transactional). This
   reuses the existing per-type `required` hook — no new send-time concept.
4. **Locked categories in the UI** come from a small explicit set,
   `requiredCategories`, seeded with `security`. A locked category renders a
   disabled toggle ("always on"). This is the UI's lock source; the send-time
   bypass remains driven by per-type `entry.required`. Both express "cannot be
   muted."
5. **Per-user only.** Scoped by `ctx.userId` + RLS. No tenant defaults in v1.

## Architecture & data flow

### Enforcement in `notify()`

File: `packages/modules/notifications/src/commands/notify.ts`.

Today `notify()` resolves recipients, then per recipient inserts the
`notification` row and, for each `defaultChannel ∩ registered`, a
`notification_delivery` row (in-app inline; email/webhook queued via
`channelJobs`).

Change: gate the **email** entries in `channelJobs` by preference.

- If `entry.required === true`, skip the whole check (email always sends).
- Otherwise, run **one** batched query for the muted set:
  `SELECT user_id FROM notification_preference WHERE tenant_id = :tenant AND
  category = :category AND channel = 'email' AND enabled = false AND user_id IN
  (:recipients)`. Build `mutedEmailUsers: Set<string>`.
- When building `channelJobs`, for `channel === 'email'` skip the job when
  `mutedEmailUsers.has(recipientUserId)`. The `notification_delivery` row for
  email is **not created** for muted recipients (no orphan "pending" row).
- In-app, webhooks, and the `notification` row writes are unchanged.

The muted-set lookup + filter is extracted into a pure helper so it is unit
testable without a DB:

File: `packages/modules/notifications/src/lib/preferences.ts`

```ts
export const NOTIFICATION_CATEGORIES = [
  "system", "team", "billing", "files", "security",
] as const;
export type PrefCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories whose notifications can never be muted (UI renders them locked). */
export const REQUIRED_CATEGORIES: ReadonlySet<PrefCategory> = new Set(["security"]);

/** Pref rows are stored per (user, category, 'email'); this is the only channel
 *  wired today. Kept as a constant so push/sms can extend it later. */
export const PREFERENCE_CHANNELS = ["email"] as const;
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

/** Given opt-out rows (enabled=false) for one category+channel, the set of
 *  muted user ids. Absence of a row = not muted. */
export function mutedUserSet(
  optOutRows: Array<{ userId: string; enabled: boolean }>,
): Set<string> {
  return new Set(optOutRows.filter((r) => !r.enabled).map((r) => r.userId));
}
```

`notify()` calls the query, passes rows to `mutedUserSet`, and filters email
jobs. The `entry.required` bypass is checked in `notify()` before the query.

### API

Both live under `/api/notifications` (chained in `routes.ts`, tenant-scoped band,
so `handlerCtx` with `tenantId`/`userId`/`withTenant` is present). All access is
RLS-scoped via `requireWithTenant` and keyed to `ctx.userId`.

**Query — `listPreferences`** (`src/queries/list-preferences.ts`)

- Input: `{}`.
- Reads the user's stored rows for `channel='email'`, overlays them on the
  category defaults, returns the effective matrix:

```ts
// ok({ preferences: [...] })
{
  preferences: Array<{
    category: PrefCategory;
    email: boolean;      // effective: default true, overridden by a stored row
    required: boolean;   // REQUIRED_CATEGORIES.has(category)
  }>;
}
```

The response always contains all 5 categories (defaults filled in) so the UI
does not need to know the catalog.

**Command — `setPreferences`** (`src/commands/set-preferences.ts`)

- Input: `{ preferences: Array<{ category: string; channel: 'email'; enabled: boolean }> }`.
- Validation (fail-loud): each `category` ∈ `NOTIFICATION_CATEGORIES`; each
  `channel` ∈ `PREFERENCE_CHANNELS`. Reject the whole request on any unknown
  value.
- Rejects writes to a `REQUIRED_CATEGORIES` category with `enabled=false`
  (can't mute a locked category) — returns a validation error.
- Upserts each entry on the unique index
  `(tenant_id, user_id, category, channel)` with `enabled` +
  `updated_at = now()`. `userId = ctx.userId`, `tenantId = ctx.tenantId`.
- Returns `ok({ updated: n })`.

**Routes** (`src/routes.ts`, appended to `notificationRoutes`)

```ts
.get("/preferences", async ({ handlerCtx }: any) => listPreferences({}, handlerCtx))
.put("/preferences", async ({ handlerCtx, body }: any) => setPreferences(body, handlerCtx))
```

### UI

**Client** (`apps/web/lib/notifications-api.ts`, extend existing file)

```ts
export interface NotificationPreference {
  category: string;
  email: boolean;
  required: boolean;
}
export async function fetchPreferences(): Promise<NotificationPreference[]> { ... }
export async function savePreferences(
  prefs: Array<{ category: string; channel: "email"; enabled: boolean }>,
): Promise<void> { ... }
```

Both use the Eden client `api.api.notifications.preferences` and throw on
`res.error` / `!res.data.success`, mirroring the existing helpers.

**Panel** (`apps/web/components/notification-preferences.tsx`)

- React Query `useQuery(['notification-preferences'], fetchPreferences)`.
- Renders a labelled list: one row per category, a `Switch` (`@baseworks/ui`)
  bound to `email`. Required categories → disabled switch + "Always on" hint.
- `useMutation(savePreferences)` on toggle (optimistic update +
  invalidate/rollback on error), toast on failure. Category labels come from
  i18n (`notifications.preferences.categories.*`).

**Settings tab** (`apps/web/app/(dashboard)/dashboard/settings/page.tsx`)

- Add a `notifications` value to the existing `Tabs`/`TabsList`, a
  `TabsTrigger`, and a `TabsContent` rendering `<NotificationPreferences />`.
  The tab is already URL-driven via `useQueryState("tab")`.

## Error handling

- Unknown category/channel in `setPreferences` → validation error (fail-loud,
  matches `getCatalogEntry` throwing on unknown types).
- Attempt to mute a `REQUIRED_CATEGORIES` category → validation error.
- `notify()` preference query failure must not silently drop email: it runs
  inside the existing tenant tx path; a thrown error fails the `notify()` call
  as today (no swallow). If no rows match, the muted set is empty → all emails
  send (safe default).
- Web: query error → inline "couldn't load preferences" state; mutation error →
  rollback + toast.

## Testing (TDD, per-suite isolation — separate `bun test` invocations)

**Unit** (`src/lib/__tests__/preferences.test.ts`)

- `mutedUserSet`: only `enabled=false` rows produce muted ids; empty rows →
  empty set; mixed rows filter correctly.
- `REQUIRED_CATEGORIES` / `NOTIFICATION_CATEGORIES` membership guards.

**Integration** (`src/__integration__/preferences.test.ts`, real DB via `_ctx`)

Setup mirrors `__integration__/notify.test.ts`: guard on a distinct
`DATABASE_URL_RLS`, register a fake in-app adapter, and register a **fake email
adapter** (`{ name: 'email', deliver: async () => ({ status: 'sent' }) }`) so
`email` is an effective channel. The current catalog has no email type, so the
test injects two temporary entries into the exported (mutable) `notificationCatalog`
object in `beforeAll` and removes them in `afterAll` — the same
`as Record<string, CatalogEntry>` cast the existing tests already use, no
production seam:

- `test.billing.email` → `{ category: "billing", severity: "info",
  defaultChannels: ["in-app", "email"], render: () => ({ title, body }) }`
- `test.security.required` → same shape with `category: "security"`,
  `required: true`.

Cases:

- Opt out of `billing` email (`setPreferences`) → `notify("test.billing.email")`
  creates the in-app `notification` row for the recipient but **no** email
  `notification_delivery` row.
- `notify("test.security.required")` with a `security` email opt-out present →
  email `notification_delivery` row **is** created (required bypass).
- No opt-out → `billing` email delivery row is created (default enabled).
- `setPreferences` then `listPreferences` round-trips; `listPreferences` returns
  all 5 categories with correct effective `email` + `required` flags.
- `setPreferences` with an unknown category rejects; muting `security` rejects.

**Web** (`apps/web/components/__tests__/notification-preferences.test.tsx`)

- Renders categories from a mocked `fetchPreferences`; required category switch
  is disabled; toggling a category calls `savePreferences` with the right
  payload; mutation error rolls back.

## Files

**Create**

- `packages/modules/notifications/src/lib/preferences.ts`
- `packages/modules/notifications/src/lib/__tests__/preferences.test.ts`
- `packages/modules/notifications/src/queries/list-preferences.ts`
- `packages/modules/notifications/src/commands/set-preferences.ts`
- `packages/modules/notifications/src/__integration__/preferences.test.ts`
- `apps/web/components/notification-preferences.tsx`
- `apps/web/components/__tests__/notification-preferences.test.tsx`

**Modify**

- `packages/modules/notifications/src/commands/notify.ts` (email gating)
- `packages/modules/notifications/src/routes.ts` (2 routes)
- `apps/web/lib/notifications-api.ts` (2 client helpers + type)
- `apps/web/app/(dashboard)/dashboard/settings/page.tsx` (new tab)
- i18n message catalogs (`notifications.preferences.*` labels)

No schema/migration change — the `notification_preference` table already exists.
```
