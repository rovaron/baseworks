# Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dormant `notification_preference` table end-to-end so users can mute email per category, `notify()` enforces it, and a settings panel manages it.

**Architecture:** A typed-union + runtime-def **category registry** (`categories.ts`) is the single source of truth for the category taxonomy (mirrors the existing `Channel`/`registerAdapter` pattern). `notify()` gates the async **email** channel per recipient using a batched opt-out query, bypassing required types and non-mutable categories. A `listPreferences` query + `setPreferences` command expose the per-user matrix over `/api/notifications/preferences`; a React Query-backed panel in `dashboard/settings` renders it dynamically. In-app is always delivered; webhooks are untouched. No schema/migration change — the table already exists.

**Tech Stack:** Bun + `bun test`, Elysia + Eden Treaty, Drizzle (postgres.js) with RLS, TypeBox validation, Next.js + React Query + next-intl, Vitest + Testing Library, `@baseworks/ui` (shadcn).

**Spec:** `docs/superpowers/specs/2026-07-01-notification-preferences-design.md`

---

## Conventions (read before starting)

- **Branch:** `feat/notification-preferences` (already checked out).
- **Commands/queries** use `defineCommand(InputSchema, async (input, ctx) => …)` / `defineQuery(…)` from `@baseworks/shared`, returning `ok(data)` or `err("CODE")`. All DB access goes through `requireWithTenant(ctx)((tx) => …)` (RLS-scoped). `ctx.userId` is typed loosely — cast with `as string` as existing code does.
- **Per-suite test isolation (project convention, see memory):** run each new test file in its **own** `bun test <path>` invocation during development. Bundling module suites can cause false mock-contamination failures.
- **Integration tests need a live DB.** They self-skip unless `DATABASE_URL_RLS` is set and **distinct** from `DATABASE_URL` (see `src/__integration__/_ctx.ts` and `notify.test.ts`). To actually run them: start Docker (`docker compose up -d postgres`), run RLS setup + migrations (`bun run db:setup-rls && bun run db:migrate`), and export both URLs (the RLS one on the `baseworks_rls` role). Without that, the guard makes them pass trivially — you MUST run them against a live DB before considering integration tasks done.
- **Commit trailers:** end every commit body with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BrhiugE2X8SySov3X6LQEB
  ```
  (Omitted from the sample commit commands below for brevity — add them.)
- **After each task:** `bun run typecheck` (root) should stay clean; `bunx biome check --write <changed files>` before committing.

---

## File Structure

**New — notifications module** (`packages/modules/notifications/src/`)

| File | Responsibility |
|---|---|
| `categories.ts` | Category taxonomy: typed `Category` union, `CategoryDef`, runtime registry (`registerCategory`/`getCategory`/`getCategories`), built-in seed. |
| `__tests__/categories.test.ts` | Registry unit tests. |
| `lib/preferences.ts` | Pure helpers: `PREFERENCE_CHANNELS`, `mutedUserSet`. |
| `lib/__tests__/preferences.test.ts` | `mutedUserSet` unit tests. |
| `commands/set-preferences.ts` | `setPreferences` command (validated upsert). |
| `queries/list-preferences.ts` | `listPreferences` query (effective matrix). |
| `__integration__/preferences.test.ts` | Live-DB: round-trip, validation, notify() email gating. |

**New — web** (`apps/web/`)

| File | Responsibility |
|---|---|
| `hooks/use-notification-preferences.ts` | React Query read + optimistic set. |
| `components/notification-preferences.tsx` | Category × email toggle panel. |
| `components/__tests__/notification-preferences.test.tsx` | Panel unit test. |

**Modified**

- `packages/modules/notifications/src/catalog.ts` — import `Category` from `./categories` (drop the local union).
- `packages/modules/notifications/src/index.ts` — re-export registry symbols.
- `packages/modules/notifications/src/commands/notify.ts` — email gating.
- `packages/modules/notifications/src/routes.ts` — 2 routes.
- `apps/web/lib/notifications-api.ts` — client helpers + type.
- `apps/web/app/(dashboard)/dashboard/settings/page.tsx` — new tab.
- `packages/i18n/src/locales/en/notifications.json` + `pt-BR/notifications.json` — `preferences.*` keys.

---

## Task 1: Category registry

**Files:**
- Create: `packages/modules/notifications/src/categories.ts`
- Create: `packages/modules/notifications/src/__tests__/categories.test.ts`
- Modify: `packages/modules/notifications/src/catalog.ts:4` (replace the `Category` union declaration)
- Modify: `packages/modules/notifications/src/index.ts:26-33` (re-export registry symbols)

- [ ] **Step 1: Write the failing test**

Create `packages/modules/notifications/src/__tests__/categories.test.ts`:

```ts
// packages/modules/notifications/src/__tests__/categories.test.ts
import { describe, expect, test } from "bun:test";
import { getCategories, getCategory, registerCategory } from "../categories";

describe("category registry", () => {
  test("seeds the five built-ins with correct mutable flags", () => {
    const cats = getCategories();
    expect(cats.map((c) => c.key).sort()).toEqual([
      "billing",
      "files",
      "security",
      "system",
      "team",
    ]);
    expect(cats.find((c) => c.key === "security")?.mutable).toBe(false);
    for (const key of ["system", "team", "billing", "files"] as const) {
      expect(getCategory(key)?.mutable).toBe(true);
    }
  });

  test("getCategory returns the full def", () => {
    expect(getCategory("security")).toEqual({ label: "Security", mutable: false });
  });

  test("registerCategory overrides an existing def and is idempotent", () => {
    registerCategory("system", { label: "System", mutable: true });
    registerCategory("system", { label: "System", mutable: true });
    expect(getCategory("system")).toEqual({ label: "System", mutable: true });
    expect(getCategories().filter((c) => c.key === "system")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/__tests__/categories.test.ts`
Expected: FAIL — `Cannot find module '../categories'`.

- [ ] **Step 3: Create the registry**

Create `packages/modules/notifications/src/categories.ts`:

```ts
// packages/modules/notifications/src/categories.ts

/**
 * The category key set — the ONE place category keys are declared. Kept a
 * compile-time union so a catalog entry's `category` field is type-checked. To
 * add a genuinely new category (rare), add its key here and register its def.
 */
export type Category = "system" | "team" | "billing" | "files" | "security";

export interface CategoryDef {
  /** Default English label; the web UI prefers its own i18n key, falls back to this. */
  label: string;
  /** false = always-on: the UI locks the toggle and setPreferences rejects opting out. */
  mutable: boolean;
}

const registry = new Map<Category, CategoryDef>();

/**
 * Register (or override) a category's def. The key is compile-time-checked, so a
 * typo can't slip in. Idempotent (safe under per-suite test re-import). Other
 * modules may call this at boot to own their category's label/mutability.
 */
export function registerCategory(key: Category, def: CategoryDef): void {
  registry.set(key, def);
}

/** The def for a category key, or undefined if not registered. */
export function getCategory(key: Category): CategoryDef | undefined {
  return registry.get(key);
}

/**
 * All registered categories in registration order — the source of truth the
 * preferences API/UI iterate over.
 */
export function getCategories(): Array<{ key: Category } & CategoryDef> {
  return [...registry.entries()].map(([key, def]) => ({ key, ...def }));
}

// Built-in taxonomy owned by the notifications module. Seeded at module load,
// UNCONDITIONALLY (not inside the REDIS_URL-gated runtime) — preferences must
// work without Redis.
registerCategory("system", { label: "System", mutable: true });
registerCategory("team", { label: "Team", mutable: true });
registerCategory("billing", { label: "Billing", mutable: true });
registerCategory("files", { label: "Files", mutable: true });
registerCategory("security", { label: "Security", mutable: false });
```

- [ ] **Step 4: Point `catalog.ts` at the registry's `Category`**

In `packages/modules/notifications/src/catalog.ts`, replace the local union (line 4):

```ts
export type Category = "system" | "team" | "billing" | "files" | "security";
```

with an import (place it with the other imports at the top, after the existing `import type { Channel } from "./channels/channel";`):

```ts
import type { Category } from "./categories";
```

Leave every other use of `Category` in the file unchanged. (The file no longer *exports* `Category`; Task 1 Step 5 moves that export to `index.ts`.)

- [ ] **Step 5: Fix the re-exports in `index.ts`**

In `packages/modules/notifications/src/index.ts`, the block at lines 26-33 currently re-exports `Category` from `./catalog`. Remove `type Category,` from that block:

```ts
export {
  type CatalogEntry,
  getCatalogEntry,
  type NotificationType,
  notificationCatalog,
  type Severity,
} from "./catalog";
```

Then add a new export block immediately below it:

```ts
export {
  type Category,
  type CategoryDef,
  getCategories,
  getCategory,
  registerCategory,
} from "./categories";
```

- [ ] **Step 6: Run test to verify it passes + typecheck**

Run: `bun test packages/modules/notifications/src/__tests__/categories.test.ts`
Expected: PASS (3 tests).

Run: `bun run typecheck`
Expected: clean (no unresolved `Category` references).

- [ ] **Step 7: Commit**

```bash
bunx biome check --write packages/modules/notifications/src/categories.ts packages/modules/notifications/src/__tests__/categories.test.ts packages/modules/notifications/src/catalog.ts packages/modules/notifications/src/index.ts
git add packages/modules/notifications/src/categories.ts packages/modules/notifications/src/__tests__/categories.test.ts packages/modules/notifications/src/catalog.ts packages/modules/notifications/src/index.ts
git commit -m "feat(notifications): category registry (typed union + runtime defs)"
```

---

## Task 2: `mutedUserSet` preference helper

**Files:**
- Create: `packages/modules/notifications/src/lib/preferences.ts`
- Create: `packages/modules/notifications/src/lib/__tests__/preferences.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/modules/notifications/src/lib/__tests__/preferences.test.ts`:

```ts
// packages/modules/notifications/src/lib/__tests__/preferences.test.ts
import { describe, expect, test } from "bun:test";
import { PREFERENCE_CHANNELS, mutedUserSet } from "../preferences";

describe("mutedUserSet", () => {
  test("collects only disabled rows", () => {
    const s = mutedUserSet([
      { userId: "a", enabled: false },
      { userId: "b", enabled: true },
      { userId: "c", enabled: false },
    ]);
    expect([...s].sort()).toEqual(["a", "c"]);
  });

  test("empty input → empty set", () => {
    expect(mutedUserSet([]).size).toBe(0);
  });

  test("all-enabled → empty set", () => {
    expect(mutedUserSet([{ userId: "a", enabled: true }]).size).toBe(0);
  });
});

describe("PREFERENCE_CHANNELS", () => {
  test("email is the only wired channel", () => {
    expect(PREFERENCE_CHANNELS).toEqual(["email"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/lib/__tests__/preferences.test.ts`
Expected: FAIL — `Cannot find module '../preferences'`.

- [ ] **Step 3: Create the helper**

Create `packages/modules/notifications/src/lib/preferences.ts`:

```ts
// packages/modules/notifications/src/lib/preferences.ts

/**
 * Preference rows are stored per (user, category, channel). Email is the only
 * channel wired today; the constant keeps push/sms extension one edit away.
 */
export const PREFERENCE_CHANNELS = ["email"] as const;
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

/**
 * From opt-out rows for a single (category, channel), the set of muted user ids.
 * Only rows with `enabled === false` mute; an absent row means "not muted".
 */
export function mutedUserSet(
  optOutRows: Array<{ userId: string; enabled: boolean }>,
): Set<string> {
  return new Set(optOutRows.filter((r) => !r.enabled).map((r) => r.userId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/lib/__tests__/preferences.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
bunx biome check --write packages/modules/notifications/src/lib/preferences.ts packages/modules/notifications/src/lib/__tests__/preferences.test.ts
git add packages/modules/notifications/src/lib/preferences.ts packages/modules/notifications/src/lib/__tests__/preferences.test.ts
git commit -m "feat(notifications): mutedUserSet preference helper"
```

---

## Task 3: `setPreferences` command

**Files:**
- Create: `packages/modules/notifications/src/commands/set-preferences.ts`
- Create: `packages/modules/notifications/src/__integration__/preferences.test.ts`

> Integration test — requires a live DB (see Conventions). It self-skips otherwise; you MUST run it against Docker Postgres before marking the task done.

- [ ] **Step 1: Write the failing integration test**

Create `packages/modules/notifications/src/__integration__/preferences.test.ts`:

```ts
// packages/modules/notifications/src/__integration__/preferences.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notificationPreference } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { setPreferences } from "../commands/set-preferences";
import { makeCtx } from "./_ctx";

const T = "notif-pref-tenant";
let live = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    live = true;
  } catch {
    live = false;
  }
});
afterAll(async () => {
  if (live) await getDb().delete(notificationPreference).where(eq(notificationPreference.tenantId, T));
});

describe("setPreferences", () => {
  test("upserts an opt-out row, then flips it back", async () => {
    if (!live) return console.warn("SKIPPED (no live DATABASE_URL_RLS)");
    const ctx = makeCtx(T, "u1");

    const r1 = await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );
    expect(r1.success).toBe(true);

    let rows = await getDb()
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.tenantId, T));
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(false);

    // Same unique key → update, not a second row.
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: true }] },
      ctx,
    );
    rows = await getDb()
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.tenantId, T));
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  }, 30_000);

  test("rejects unknown category", async () => {
    if (!live) return console.warn("SKIPPED");
    const r = await setPreferences(
      { preferences: [{ category: "nope", channel: "email", enabled: false }] },
      makeCtx(T, "u1"),
    );
    expect(r.success).toBe(false);
  }, 30_000);

  test("rejects muting a non-mutable (security) category", async () => {
    if (!live) return console.warn("SKIPPED");
    const r = await setPreferences(
      { preferences: [{ category: "security", channel: "email", enabled: false }] },
      makeCtx(T, "u1"),
    );
    expect(r.success).toBe(false);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/__integration__/preferences.test.ts`
Expected: FAIL — `Cannot find module '../commands/set-preferences'` (or, without a live DB, it errors on the missing import before skipping).

- [ ] **Step 3: Create the command**

Create `packages/modules/notifications/src/commands/set-preferences.ts`:

```ts
// packages/modules/notifications/src/commands/set-preferences.ts
import { notificationPreference } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import type { Category } from "../categories";
import { getCategory } from "../categories";
import { PREFERENCE_CHANNELS } from "../lib/preferences";

const Input = Type.Object({
  preferences: Type.Array(
    Type.Object({
      category: Type.String(),
      channel: Type.String(),
      enabled: Type.Boolean(),
    }),
  ),
});

/**
 * Upsert the current user's notification preferences. Validates every entry
 * up-front (fail-loud): the category must be registered, the channel must be
 * wired, and a `mutable: false` category (e.g. security) cannot be muted. All
 * rows are written under one RLS-scoped transaction, keyed to `ctx.userId`.
 */
export const setPreferences = defineCommand(Input, async (input, ctx) => {
  for (const p of input.preferences) {
    const def = getCategory(p.category as Category);
    if (!def) return err("UNKNOWN_CATEGORY");
    if (!(PREFERENCE_CHANNELS as readonly string[]).includes(p.channel)) {
      return err("UNKNOWN_CHANNEL");
    }
    if (!def.mutable && p.enabled === false) return err("CATEGORY_NOT_MUTABLE");
  }

  await requireWithTenant(ctx)(async (tx) => {
    for (const p of input.preferences) {
      await tx
        .insert(notificationPreference)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId as string,
          category: p.category,
          channel: p.channel,
          enabled: p.enabled,
          // biome-ignore lint/suspicious/noExplicitAny: insert shape narrowed by schema
        } as any)
        .onConflictDoUpdate({
          target: [
            notificationPreference.tenantId,
            notificationPreference.userId,
            notificationPreference.category,
            notificationPreference.channel,
          ],
          set: { enabled: p.enabled, updatedAt: new Date() },
        });
    }
  });

  return ok({ updated: input.preferences.length });
});
```

- [ ] **Step 4: Run test to verify it passes (live DB)**

Ensure Docker Postgres is up and `DATABASE_URL` + a distinct `DATABASE_URL_RLS` are exported (see Conventions).
Run: `bun test packages/modules/notifications/src/__integration__/preferences.test.ts`
Expected: PASS (3 tests) with the DB live. If you see `SKIPPED` warnings, the env is not configured — fix it and re-run; do not accept a skip as a pass.

- [ ] **Step 5: Commit**

```bash
bunx biome check --write packages/modules/notifications/src/commands/set-preferences.ts packages/modules/notifications/src/__integration__/preferences.test.ts
git add packages/modules/notifications/src/commands/set-preferences.ts packages/modules/notifications/src/__integration__/preferences.test.ts
git commit -m "feat(notifications): setPreferences command (validated upsert)"
```

---

## Task 4: `listPreferences` query

**Files:**
- Create: `packages/modules/notifications/src/queries/list-preferences.ts`
- Modify: `packages/modules/notifications/src/__integration__/preferences.test.ts` (append a describe block)

- [ ] **Step 1: Add the failing test**

Append to `packages/modules/notifications/src/__integration__/preferences.test.ts`. First add the import at the top with the other imports:

```ts
import { listPreferences } from "../queries/list-preferences";
```

Then append this describe block at the end of the file:

```ts
describe("listPreferences", () => {
  test("returns every registered category with effective email + mutable", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "u-list");
    // Mute billing for this user.
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );

    const res = await listPreferences({}, ctx);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const prefs = res.data.preferences;

    // All five registered categories present.
    expect(prefs.map((p) => p.category).sort()).toEqual([
      "billing",
      "files",
      "security",
      "system",
      "team",
    ]);
    // billing muted, others default-enabled.
    expect(prefs.find((p) => p.category === "billing")?.email).toBe(false);
    expect(prefs.find((p) => p.category === "system")?.email).toBe(true);
    // security is locked.
    expect(prefs.find((p) => p.category === "security")?.mutable).toBe(false);
    expect(prefs.find((p) => p.category === "billing")?.mutable).toBe(true);
    // labels come through.
    expect(prefs.find((p) => p.category === "security")?.label).toBe("Security");
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/__integration__/preferences.test.ts`
Expected: FAIL — `Cannot find module '../queries/list-preferences'`.

- [ ] **Step 3: Create the query**

Create `packages/modules/notifications/src/queries/list-preferences.ts`:

```ts
// packages/modules/notifications/src/queries/list-preferences.ts
import { notificationPreference } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { getCategories } from "../categories";

const Input = Type.Object({});

/**
 * The current user's effective email preferences: every registered category
 * with its label + mutable flag, overlaid with the user's stored opt-outs
 * (absent row = enabled). Driven entirely by the category registry, so the UI
 * hardcodes no category list.
 */
export const listPreferences = defineQuery(Input, async (_input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notificationPreference)
      .where(
        and(
          eq(notificationPreference.userId, ctx.userId as string),
          eq(notificationPreference.channel, "email"),
        ),
      ),
  )) as (typeof notificationPreference.$inferSelect)[];

  const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.category));

  const preferences = getCategories().map((c) => ({
    category: c.key,
    label: c.label,
    email: !disabled.has(c.key),
    mutable: c.mutable,
  }));

  return ok({ preferences });
});
```

- [ ] **Step 4: Run test to verify it passes (live DB)**

Run: `bun test packages/modules/notifications/src/__integration__/preferences.test.ts`
Expected: PASS (4 tests total — the 3 from Task 3 plus this one).

- [ ] **Step 5: Commit**

```bash
bunx biome check --write packages/modules/notifications/src/queries/list-preferences.ts packages/modules/notifications/src/__integration__/preferences.test.ts
git add packages/modules/notifications/src/queries/list-preferences.ts packages/modules/notifications/src/__integration__/preferences.test.ts
git commit -m "feat(notifications): listPreferences query (effective matrix)"
```

---

## Task 5: `notify()` email gating

**Files:**
- Modify: `packages/modules/notifications/src/commands/notify.ts`
- Modify: `packages/modules/notifications/src/__integration__/preferences.test.ts` (append a describe block + catalog/adapter setup)

- [ ] **Step 1: Add the failing test (with catalog injection + fake email adapter)**

Append to `packages/modules/notifications/src/__integration__/preferences.test.ts`. First, **edit the existing `@baseworks/db` import** (added in Task 3) to also pull in `notification` + `notificationDelivery`:

```ts
import { getDb, notification, notificationDelivery, notificationPreference } from "@baseworks/db";
```

Then add these new imports at the top:

```ts
import { type CatalogEntry, notificationCatalog } from "../catalog";
import { registerAdapter } from "../channels/registry";
import { notify } from "../commands/notify";
```

The current catalog has no email-dispatching type, so inject two temporary entries and register fake adapters (so both `in-app` and `email` are effective channels without needing Redis). Add this to the EXISTING `beforeAll` (after `live = true;`) and matching cleanup in `afterAll`:

```ts
// inside beforeAll, after `live = true;`
if (live) {
  // Fake adapters so both channels are "registered" (no real send / publish).
  registerAdapter({ name: "in-app", deliver: async () => ({ status: "sent" as const }) });
  registerAdapter({ name: "email", deliver: async () => ({ status: "sent" as const }) });
  // Temporary catalog types: one plain billing-email type, one required billing
  // type (isolates the required-bypass path from the category-mutable path).
  const cat = notificationCatalog as Record<string, CatalogEntry>;
  cat["test.billing.email"] = {
    category: "billing",
    severity: "info",
    defaultChannels: ["in-app", "email"],
    render: () => ({ title: "t", body: "b" }),
  };
  cat["test.billing.required"] = {
    category: "billing",
    severity: "info",
    defaultChannels: ["in-app", "email"],
    required: true,
    render: () => ({ title: "t", body: "b" }),
  };
}
```

```ts
// inside afterAll, alongside the existing preference cleanup
if (live) {
  await getDb().delete(notification).where(eq(notification.tenantId, T));
  const cat = notificationCatalog as Record<string, CatalogEntry>;
  delete cat["test.billing.email"];
  delete cat["test.billing.required"];
}
```

Then append this describe block at the end of the file:

```ts
async function emailDeliveries(tenantId: string, notificationId: string) {
  return getDb()
    .select()
    .from(notificationDelivery)
    .where(eq(notificationDelivery.notificationId, notificationId));
}

describe("notify() email gating", () => {
  test("muted category → in-app row created but NO email delivery row", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "gate-1");
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );

    const res = await notify(
      { type: "test.billing.email", recipients: { userIds: ["gate-1"] } },
      ctx,
    );
    expect(res.success).toBe(true);
    if (!res.success) return;

    const rows = await getDb()
      .select()
      .from(notification)
      .where(eq(notification.tenantId, T));
    const mine = rows.filter((r) => r.recipientUserId === "gate-1");
    expect(mine).toHaveLength(1); // in-app row still created
    const deliveries = await emailDeliveries(T, mine[0].id);
    expect(deliveries.some((d) => d.channel === "email")).toBe(false); // no email row
    expect(deliveries.some((d) => d.channel === "in-app")).toBe(true);
  }, 30_000);

  test("required type bypasses the opt-out (email delivery row IS created)", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "gate-2");
    await setPreferences(
      { preferences: [{ category: "billing", channel: "email", enabled: false }] },
      ctx,
    );

    const res = await notify(
      { type: "test.billing.required", recipients: { userIds: ["gate-2"] } },
      ctx,
    );
    expect(res.success).toBe(true);
    if (!res.success) return;

    const rows = await getDb()
      .select()
      .from(notification)
      .where(eq(notification.tenantId, T));
    const mine = rows.filter((r) => r.recipientUserId === "gate-2");
    const deliveries = await emailDeliveries(T, mine[0].id);
    expect(deliveries.some((d) => d.channel === "email")).toBe(true);
  }, 30_000);

  test("no opt-out → email delivery row created", async () => {
    if (!live) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "gate-3");
    const res = await notify(
      { type: "test.billing.email", recipients: { userIds: ["gate-3"] } },
      ctx,
    );
    expect(res.success).toBe(true);
    if (!res.success) return;

    const rows = await getDb()
      .select()
      .from(notification)
      .where(eq(notification.tenantId, T));
    const mine = rows.filter((r) => r.recipientUserId === "gate-3");
    const deliveries = await emailDeliveries(T, mine[0].id);
    expect(deliveries.some((d) => d.channel === "email")).toBe(true);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/__integration__/preferences.test.ts`
Expected: FAIL — the "muted category" test finds an email delivery row (gating not yet implemented), so `expect(...).toBe(false)` fails.

- [ ] **Step 3: Implement the gating in `notify.ts`**

In `packages/modules/notifications/src/commands/notify.ts`:

a) Extend the imports. Change the db import (line 2-7) to add `notificationPreference`:

```ts
import {
  notification,
  notificationDelivery,
  notificationPreference,
  notificationWebhook,
  notificationWebhookDelivery,
} from "@baseworks/db";
```

Change the drizzle import (line 10) to add `inArray`:

```ts
import { and, eq, inArray } from "drizzle-orm";
```

Add two module imports next to the existing ones (after line 15, `import { resolveRecipients } from "../lib/recipients";`):

```ts
import { getCategory } from "../categories";
import { mutedUserSet } from "../lib/preferences";
```

b) After the `channels` line (currently line 45:
`const channels = entry.defaultChannels.filter((c) => registeredChannels().includes(c));`)
and BEFORE `const createdIds: string[] = [];`, insert the muted-set computation:

```ts
  // Email preference gate. Bypassed entirely for `required` types or for
  // categories that are not `mutable` (always-on, e.g. security). An unregistered
  // category resolves to undefined → treated as non-mutable → delivered (safe:
  // never silently drop). Otherwise fetch this category's email opt-outs for the
  // resolved recipients, once, before the per-recipient loop.
  const emailBypass =
    entry.required === true || getCategory(entry.category)?.mutable !== true;
  let mutedEmail = new Set<string>();
  if (!emailBypass && channels.includes("email") && recipients.size > 0) {
    const optOut = await requireWithTenant(ctx)((tx) =>
      tx
        .select({
          userId: notificationPreference.userId,
          enabled: notificationPreference.enabled,
        })
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.category, entry.category),
            eq(notificationPreference.channel, "email"),
            eq(notificationPreference.enabled, false),
            inArray(notificationPreference.userId, [...recipients]),
          ),
        ),
    );
    mutedEmail = mutedUserSet(optOut as Array<{ userId: string; enabled: boolean }>);
  }
```

c) In the channel loop (currently `for (const channel of channels) {` at line 71), add a skip as the FIRST statement inside the loop, so the email delivery row is not even created for muted recipients:

```ts
      for (const channel of channels) {
        if (channel === "email" && mutedEmail.has(recipientUserId)) continue;
        // ...existing body unchanged (insert notificationDelivery, in-app inline / else push job)
```

- [ ] **Step 4: Run test to verify it passes (live DB)**

Run: `bun test packages/modules/notifications/src/__integration__/preferences.test.ts`
Expected: PASS (7 tests total).

Also run the existing notify suite to confirm no regression:
Run: `bun test packages/modules/notifications/src/__integration__/notify.test.ts`
Expected: PASS (unchanged — `system.test` is in-app-only, `system` is mutable but has no email channel, so the gate is a no-op there).

- [ ] **Step 5: Commit**

```bash
bunx biome check --write packages/modules/notifications/src/commands/notify.ts packages/modules/notifications/src/__integration__/preferences.test.ts
git add packages/modules/notifications/src/commands/notify.ts packages/modules/notifications/src/__integration__/preferences.test.ts
git commit -m "feat(notifications): gate email delivery by user preference in notify()"
```

---

## Task 6: HTTP routes + Eden types

**Files:**
- Modify: `packages/modules/notifications/src/routes.ts`

- [ ] **Step 1: Add the imports**

In `packages/modules/notifications/src/routes.ts`, add two imports alongside the existing command/query imports (after line 13, `import { listWebhooks } from "./queries/list-webhooks";`):

```ts
import { setPreferences } from "./commands/set-preferences";
import { listPreferences } from "./queries/list-preferences";
```

- [ ] **Step 2: Add the two routes**

In the same file, append these two chained calls to the `notificationRoutes` Elysia chain. Put them immediately after the `.post("/read-all", …)` line (line 47) so preference routes sit with the other per-user routes, before the webhook routes:

```ts
  .get("/preferences", async ({ handlerCtx }: any) => listPreferences({}, handlerCtx))
  .put("/preferences", async ({ handlerCtx, body }: any) => setPreferences(body, handlerCtx))
```

- [ ] **Step 3: Verify types compile (Eden end-to-end)**

Run: `bun run typecheck`
Expected: clean — the routes resolve `handlerCtx` and the command/query signatures.

Run: `cd apps/web && bunx tsc --noEmit && cd ../..`
Expected: clean — confirms the new routes are reachable on the typed Eden client (`api.api.notifications.preferences`) that Task 7 will call. (The root typecheck excludes apps/web, so this separate check matters.)

- [ ] **Step 4: Commit**

```bash
bunx biome check --write packages/modules/notifications/src/routes.ts
git add packages/modules/notifications/src/routes.ts
git commit -m "feat(notifications): expose GET/PUT /api/notifications/preferences"
```

---

## Task 7: Web API client helpers

**Files:**
- Modify: `apps/web/lib/notifications-api.ts`

- [ ] **Step 1: Add the type + two helpers**

Append to `apps/web/lib/notifications-api.ts` (the file already defines `const n = () => api.api.notifications;`):

```ts
export interface NotificationPreference {
  category: string;
  label: string;
  email: boolean;
  mutable: boolean;
}

export async function fetchPreferences(): Promise<NotificationPreference[]> {
  const res = await n().preferences.get();
  if (res.error) throw res.error;
  if (!res.data.success) throw new Error(res.data.error);
  return res.data.data.preferences;
}

export async function savePreferences(
  prefs: Array<{ category: string; channel: "email"; enabled: boolean }>,
): Promise<void> {
  const res = await n().preferences.put({ preferences: prefs });
  if (res.error) throw res.error;
  if (!res.data.success) throw new Error(res.data.error);
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd apps/web && bunx tsc --noEmit && cd ../..`
Expected: clean — `n().preferences.get()` / `.put(...)` resolve against the Eden types from Task 6. If `.preferences` is `unknown`/errors, Task 6's route types didn't reach the client — recheck the static route chaining before continuing.

- [ ] **Step 3: Commit**

```bash
bunx biome check --write apps/web/lib/notifications-api.ts
git add apps/web/lib/notifications-api.ts
git commit -m "feat(web): notification preferences API client helpers"
```

---

## Task 8: i18n keys

**Files:**
- Modify: `packages/i18n/src/locales/en/notifications.json`
- Modify: `packages/i18n/src/locales/pt-BR/notifications.json`

- [ ] **Step 1: Add English keys**

In `packages/i18n/src/locales/en/notifications.json`, add a `preferences` object as a sibling of `webhooks` (add a comma after the `webhooks` object's closing brace):

```json
  "preferences": {
    "tabLabel": "Notifications",
    "title": "Notification preferences",
    "description": "Choose which email notifications you receive. In-app notifications are always shown.",
    "alwaysOn": "Always on",
    "saved": "Preferences saved",
    "loadError": "Couldn't load your preferences.",
    "categories": {
      "system": "System",
      "team": "Team",
      "billing": "Billing",
      "files": "Files",
      "security": "Security"
    }
  }
```

- [ ] **Step 2: Add Portuguese keys**

In `packages/i18n/src/locales/pt-BR/notifications.json`, add the same structure translated (again as a sibling of `webhooks`):

```json
  "preferences": {
    "tabLabel": "Notificações",
    "title": "Preferências de notificação",
    "description": "Escolha quais notificações por e-mail você recebe. As notificações no aplicativo são sempre exibidas.",
    "alwaysOn": "Sempre ativo",
    "saved": "Preferências salvas",
    "loadError": "Não foi possível carregar suas preferências.",
    "categories": {
      "system": "Sistema",
      "team": "Equipe",
      "billing": "Cobrança",
      "files": "Arquivos",
      "security": "Segurança"
    }
  }
```

- [ ] **Step 3: Verify JSON is valid**

Run: `bun -e "JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/en/notifications.json','utf8')); JSON.parse(require('fs').readFileSync('packages/i18n/src/locales/pt-BR/notifications.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no parse error / trailing-comma mistakes).

- [ ] **Step 4: Commit**

```bash
bunx biome check --write packages/i18n/src/locales/en/notifications.json packages/i18n/src/locales/pt-BR/notifications.json
git add packages/i18n/src/locales/en/notifications.json packages/i18n/src/locales/pt-BR/notifications.json
git commit -m "feat(i18n): notification preferences labels (en + pt-BR)"
```

---

## Task 9: Preferences hook + panel + component test

**Files:**
- Create: `apps/web/hooks/use-notification-preferences.ts`
- Create: `apps/web/components/notification-preferences.tsx`
- Create: `apps/web/components/__tests__/notification-preferences.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `apps/web/components/__tests__/notification-preferences.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const setEmail = vi.fn(async () => {});
vi.mock("@/hooks/use-notification-preferences", () => ({
  useNotificationPreferences: () => ({
    preferences: [
      { category: "billing", label: "Billing", email: true, mutable: true },
      { category: "security", label: "Security", email: true, mutable: false },
    ],
    isLoading: false,
    isError: false,
    setEmail,
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { NotificationPreferences } from "../notification-preferences";

describe("NotificationPreferences", () => {
  test("locks the non-mutable category switch", () => {
    render(<NotificationPreferences />);
    const switches = screen.getAllByRole("switch");
    expect(switches[0]).not.toBeDisabled(); // billing
    expect(switches[1]).toBeDisabled(); // security
  });

  test("toggling a mutable category calls setEmail(category, false)", () => {
    render(<NotificationPreferences />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(setEmail).toHaveBeenCalledWith("billing", false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run components/__tests__/notification-preferences.test.tsx && cd ../..`
Expected: FAIL — `Cannot find module '../notification-preferences'`.

- [ ] **Step 3: Create the hook**

Create `apps/web/hooks/use-notification-preferences.ts`:

```ts
// apps/web/hooks/use-notification-preferences.ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useTenant } from "@/components/tenant-provider";
import {
  type NotificationPreference,
  fetchPreferences,
  savePreferences,
} from "@/lib/notifications-api";

const KEY = "notification-preferences";

export function useNotificationPreferences() {
  const { activeTenant } = useTenant();
  const tenantId = activeTenant?.id;
  const qc = useQueryClient();
  const t = useTranslations("notifications");
  const tc = useTranslations("common");

  const query = useQuery({
    queryKey: [KEY, tenantId],
    queryFn: () => fetchPreferences(),
    enabled: !!tenantId,
  });

  const setM = useMutation({
    mutationFn: (prefs: Array<{ category: string; channel: "email"; enabled: boolean }>) =>
      savePreferences(prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: [KEY] });
      const prev = qc.getQueryData<NotificationPreference[]>([KEY, tenantId]);
      if (prev) {
        const next = new Map(prefs.map((p) => [p.category, p.enabled]));
        qc.setQueryData<NotificationPreference[]>(
          [KEY, tenantId],
          prev.map((p) => (next.has(p.category) ? { ...p, email: next.get(p.category)! } : p)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, context) => {
      if (context?.prev) qc.setQueryData([KEY, tenantId], context.prev);
      toast.error(tc("error"));
    },
    onSuccess: () => toast.success(t("preferences.saved")),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  return {
    preferences: (query.data ?? []) as NotificationPreference[],
    isLoading: query.isPending && !!tenantId,
    isError: query.isError,
    setEmail: (category: string, enabled: boolean) =>
      setM.mutateAsync([{ category, channel: "email", enabled }]),
  };
}
```

- [ ] **Step 4: Create the panel**

Create `apps/web/components/notification-preferences.tsx`:

```tsx
// apps/web/components/notification-preferences.tsx
"use client";
import { Label, Skeleton, Switch } from "@baseworks/ui";
import { useTranslations } from "next-intl";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";

export function NotificationPreferences() {
  const t = useTranslations("notifications");
  const { preferences, isLoading, isError, setEmail } = useNotificationPreferences();

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <p className="text-sm text-destructive">{t("preferences.loadError")}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{t("preferences.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("preferences.description")}</p>
      </div>
      <ul className="divide-y rounded-md border">
        {preferences.map((p) => (
          <li key={p.category} className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor={`pref-${p.category}`}>
                {t(`preferences.categories.${p.category}`)}
              </Label>
              {!p.mutable && (
                <p className="text-xs text-muted-foreground">{t("preferences.alwaysOn")}</p>
              )}
            </div>
            <Switch
              id={`pref-${p.category}`}
              checked={p.email}
              disabled={!p.mutable}
              onCheckedChange={(v) => setEmail(p.category, v)}
              aria-label={t(`preferences.categories.${p.category}`)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run components/__tests__/notification-preferences.test.tsx && cd ../..`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit && cd ../..`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write apps/web/hooks/use-notification-preferences.ts apps/web/components/notification-preferences.tsx apps/web/components/__tests__/notification-preferences.test.tsx
git add apps/web/hooks/use-notification-preferences.ts apps/web/components/notification-preferences.tsx apps/web/components/__tests__/notification-preferences.test.tsx
git commit -m "feat(web): notification preferences panel + hook"
```

---

## Task 10: Settings tab wiring

**Files:**
- Modify: `apps/web/app/(dashboard)/dashboard/settings/page.tsx`

- [ ] **Step 1: Wire the tab**

Edit `apps/web/app/(dashboard)/dashboard/settings/page.tsx`:

a) Add the import at the top (with the other `@/components` imports):

```ts
import { NotificationPreferences } from "@/components/notification-preferences";
```

b) Inside `SettingsContent`, add a second translator next to `const t = useTranslations("invite");`:

```ts
  const tn = useTranslations("notifications");
```

c) Add a `TabsTrigger` after the existing team trigger:

```tsx
        <TabsList>
          <TabsTrigger value="team">{t("settings.tabs.team")}</TabsTrigger>
          <TabsTrigger value="notifications">{tn("preferences.tabLabel")}</TabsTrigger>
        </TabsList>
```

d) Add a `TabsContent` after the existing team content's closing `</TabsContent>`:

```tsx
        <TabsContent value="notifications">
          <NotificationPreferences />
        </TabsContent>
```

- [ ] **Step 2: Typecheck + web tests**

Run: `cd apps/web && bunx tsc --noEmit && bun run test && cd ../..`
Expected: typecheck clean; the full web Vitest suite passes (including the panel test from Task 9).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Boot the app (API on :3000 with a dummy `STRIPE_WEBHOOK_SECRET`, web on :3001 — see the local-app-QA-boot notes). Sign in, go to `/dashboard/settings?tab=notifications`, toggle Billing email off, reload — it stays off; the Security row is disabled with an "Always on" hint.

- [ ] **Step 4: Commit**

```bash
bunx biome check --write "apps/web/app/(dashboard)/dashboard/settings/page.tsx"
git add "apps/web/app/(dashboard)/dashboard/settings/page.tsx"
git commit -m "feat(web): notification preferences tab in settings"
```

---

## Final verification

- [ ] **Full module test suite (per-suite, live DB for integration):**
  ```bash
  bun test packages/modules/notifications/src/__tests__/categories.test.ts
  bun test packages/modules/notifications/src/lib/__tests__/preferences.test.ts
  bun test packages/modules/notifications/src/__integration__/preferences.test.ts   # needs DATABASE_URL_RLS
  bun test packages/modules/notifications                                            # whole module, no regressions
  ```
- [ ] **Root typecheck + web typecheck:** `bun run typecheck && (cd apps/web && bunx tsc --noEmit)`
- [ ] **Web suite:** `cd apps/web && bun run test`
- [ ] **Biome clean:** `bunx biome check .`
- [ ] Open a PR to `main`, let CI run, then merge.

---

## Out of scope (tracked follow-ups — do NOT build here)

- **Per-module catalog type registration** (`registerNotificationType`) — the change that removes the real growth bottleneck as notification *types* multiply. Independent of this task; composes with the Level-1 category union.
- **Tenant-admin default preferences** — needs a schema change (nullable `user_id` or a defaults table).
- **Push/SMS channels** — reuse the `channel` column + `PREFERENCE_CHANNELS` once those adapters exist.
