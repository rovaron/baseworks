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
3. **Categories are a Level-1 registry (typed union + runtime defs).** This is
   the `Channel`/`registerAdapter` pattern already in the codebase: the category
   *keys* are a central typed union (`Category`), while each category's *def*
   (`{ label, mutable }`) is registered at runtime via `registerCategory`. The
   notifications module seeds the built-in taxonomy; other modules can register
   their own category's def at boot without editing notifications-module files.
   `Category` stays compile-time safe (so a catalog entry's `category` field is
   checked); adding a brand-new key is a one-line union edit (rare). Chosen over a
   fully-static object (couples every producer to one shared file) and over
   declaration-merging (decouples keys too, but adds `declare module` ceremony
   that's too magic for a starter kit).
4. **"Mutable" drives both the send-time bypass and the UI lock.** A category
   with `mutable: false` (seeded: `security`) can never be muted — the UI renders
   it as a disabled toggle and `setPreferences` rejects opting out of it.
   Independently, any *type* with `required: true` in the catalog also bypasses
   preferences (a transactional type inside an otherwise-mutable category, e.g. a
   failed-payment email in `billing`). Effective rule in `notify()`:
   **deliver-regardless when `entry.required || !getCategory(category)?.mutable`.**
5. **Per-user only.** Scoped by `ctx.userId` + RLS. No tenant defaults in v1.
6. **Catalog stays static; per-module type registration is a tracked follow-up.**
   This task decouples *categories* (what preferences read). Migrating the
   *catalog* of notification **types** to per-module registration — the change
   that removes the real growth bottleneck as types multiply — is deliberately
   out of scope here and noted under "Follow-up" below. A type's `category` field
   remains type-checked against the Level-1 union regardless, so the two compose.

## Architecture & data flow

### Category registry

File: `packages/modules/notifications/src/categories.ts` (new). Holds the typed
key union, the runtime def registry, and seeds the built-in taxonomy at module
load — **unconditionally** (not inside `ensureNotificationsRuntime()`, which is
`REDIS_URL`-gated; preferences must work without Redis).

```ts
export type Category = "system" | "team" | "billing" | "files" | "security";
export interface CategoryDef {
  label: string;    // default English label; UI prefers its own i18n key, falls back to this
  mutable: boolean; // false = always-on (UI locks it, setPreferences rejects opt-out)
}

const registry = new Map<Category, CategoryDef>();
export function registerCategory(key: Category, def: CategoryDef): void {
  registry.set(key, def); // key is compile-time-checked; idempotent (safe under per-suite re-import)
}
export function getCategory(key: Category): CategoryDef | undefined {
  return registry.get(key);
}
/** All registered categories in insertion order — the source of truth for the API/UI. */
export function getCategories(): Array<{ key: Category } & CategoryDef> {
  return [...registry.entries()].map(([key, def]) => ({ key, ...def }));
}

// Built-in taxonomy owned by the notifications module. Other modules may call
// registerCategory() at their own boot to add a def for a new key.
registerCategory("system", { label: "System", mutable: true });
registerCategory("team", { label: "Team", mutable: true });
registerCategory("billing", { label: "Billing", mutable: true });
registerCategory("files", { label: "Files", mutable: true });
registerCategory("security", { label: "Security", mutable: false });
```

`catalog.ts` imports `Category` from here instead of declaring its own union
(single source of truth for the key set); `index.ts` re-exports `Category`,
`registerCategory`, and the `CategoryDef` type from `./categories`.

### Enforcement in `notify()`

File: `packages/modules/notifications/src/commands/notify.ts`.

Today `notify()` resolves recipients, then per recipient inserts the
`notification` row and, for each `defaultChannel ∩ registered`, a
`notification_delivery` row (in-app inline; email/webhook queued via
`channelJobs`).

Change: gate the **email** entries in `channelJobs` by preference.

- **Bypass rule:** if `entry.required || !getCategory(entry.category)?.mutable`,
  skip the whole preference check — email always sends (transactional type, or an
  always-on category like `security`). An unknown category resolves to
  `undefined` → treated as non-mutable → delivered (safe default, never silently
  dropped).
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
/** Pref rows are stored per (user, category, 'email'); email is the only channel
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

The category key set + `mutable` flags live in `categories.ts` (above), not here.
`notify()` applies the bypass rule, runs the query, passes rows to `mutedUserSet`,
and filters email jobs.

### API

Both live under `/api/notifications` (chained in `routes.ts`, tenant-scoped band,
so `handlerCtx` with `tenantId`/`userId`/`withTenant` is present). All access is
RLS-scoped via `requireWithTenant` and keyed to `ctx.userId`.

**Query — `listPreferences`** (`src/queries/list-preferences.ts`)

- Input: `{}`.
- Iterates `getCategories()`, overlays the user's stored `channel='email'` rows,
  returns the effective matrix driven entirely by the registry:

```ts
// ok({ preferences: [...] })
{
  preferences: Array<{
    category: Category;  // key
    label: string;       // registry def label (UI may prefer its own i18n)
    email: boolean;      // effective: default true, overridden by a stored row
    mutable: boolean;    // registry def; false => UI locks the toggle
  }>;
}
```

The response contains every registered category (in registry order) so the UI
maps over it with nothing hardcoded — add a category to the registry and it
appears here automatically.

**Command — `setPreferences`** (`src/commands/set-preferences.ts`)

- Input: `{ preferences: Array<{ category: string; channel: 'email'; enabled: boolean }> }`.
- Validation (fail-loud): each `category` must resolve via `getCategory(...)`
  (i.e. be registered); each `channel` ∈ `PREFERENCE_CHANNELS`. Reject the whole
  request on any unknown value.
- Rejects `enabled=false` for a category whose def is `mutable: false`
  (can't mute an always-on category) — returns a validation error.
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
  label: string;
  email: boolean;
  mutable: boolean;
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
  bound to `email`. `mutable: false` categories → disabled switch + "Always on"
  hint.
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
- Attempt to mute a `mutable: false` category → validation error.
- `notify()` preference query failure must not silently drop email: it runs
  inside the existing tenant tx path; a thrown error fails the `notify()` call
  as today (no swallow). If no rows match, the muted set is empty → all emails
  send (safe default).
- Web: query error → inline "couldn't load preferences" state; mutation error →
  rollback + toast.

## Testing (TDD, per-suite isolation — separate `bun test` invocations)

**Unit** (`src/lib/__tests__/preferences.test.ts` + `src/__tests__/categories.test.ts`)

- `mutedUserSet`: only `enabled=false` rows produce muted ids; empty rows →
  empty set; mixed rows filter correctly.
- Category registry: `getCategories()` returns the 5 built-ins with correct
  `mutable` flags (`security` locked, rest mutable); `getCategory('security')?.mutable === false`;
  `registerCategory` adds/overrides a def and is idempotent.

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
- `test.billing.required` → same shape, `required: true` (a transactional type
  inside the otherwise-mutable `billing` category — isolates the required-bypass
  path from the category `mutable` path).

Cases:

- Opt out of `billing` email (`setPreferences`) → `notify("test.billing.email")`
  creates the in-app `notification` row for the recipient but **no** email
  `notification_delivery` row.
- Same `billing` opt-out present → `notify("test.billing.required")` **does**
  create the email `notification_delivery` row (per-type `required` bypass, even
  though the category is muted).
- No opt-out → `test.billing.email` email delivery row is created (default enabled).
- `setPreferences` then `listPreferences` round-trips; `listPreferences` returns
  all registered categories with correct effective `email` + `mutable` flags.
- `setPreferences` with an unknown category rejects; muting `security`
  (`mutable: false`) rejects.

**Web** (`apps/web/components/__tests__/notification-preferences.test.tsx`)

- Renders categories from a mocked `fetchPreferences`; required category switch
  is disabled; toggling a category calls `savePreferences` with the right
  payload; mutation error rolls back.

## Files

**Create**

- `packages/modules/notifications/src/categories.ts` (category registry)
- `packages/modules/notifications/src/__tests__/categories.test.ts`
- `packages/modules/notifications/src/lib/preferences.ts`
- `packages/modules/notifications/src/lib/__tests__/preferences.test.ts`
- `packages/modules/notifications/src/queries/list-preferences.ts`
- `packages/modules/notifications/src/commands/set-preferences.ts`
- `packages/modules/notifications/src/__integration__/preferences.test.ts`
- `apps/web/components/notification-preferences.tsx`
- `apps/web/components/__tests__/notification-preferences.test.tsx`

**Modify**

- `packages/modules/notifications/src/catalog.ts` (import `Category` from
  `./categories` instead of declaring the union)
- `packages/modules/notifications/src/index.ts` (re-export `Category`,
  `CategoryDef`, `registerCategory`, `getCategories` from `./categories`)
- `packages/modules/notifications/src/commands/notify.ts` (email gating)
- `packages/modules/notifications/src/routes.ts` (2 routes)
- `apps/web/lib/notifications-api.ts` (2 client helpers + type)
- `apps/web/app/(dashboard)/dashboard/settings/page.tsx` (new tab)
- i18n message catalogs (`notifications.preferences.*` labels)

No schema/migration change — the `notification_preference` table already exists.

## Follow-up (out of scope, tracked)

- **Per-module catalog registration.** Migrate the static `notificationCatalog`
  to a runtime `registerNotificationType()` seam (mirroring `registerCategory` /
  `registerAdapter`) so each producing module owns its notification **types**
  without editing the notifications module. This is where decoupling pays off as
  types multiply; it's independent of this task and composes with the Level-1
  category union (a type's `category` stays type-checked). Do it when real typed
  producers start landing.
- **Tenant-admin default preferences.** Requires a schema change (nullable
  `user_id` or a separate defaults table); would let an org set baseline opt-outs
  users inherit.
- **Additional per-user channels** (push/SMS) reuse the same `channel` column and
  `PREFERENCE_CHANNELS` constant once those adapters exist.
```
