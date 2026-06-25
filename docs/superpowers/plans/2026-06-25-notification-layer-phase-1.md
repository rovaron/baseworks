# Notification Layer — Phase 1 Implementation Plan (Schema + Module Skeleton)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. (This repo executes phases via the gated multi-agent Workflow pattern.)

**Goal:** Stand up the `@baseworks/module-notifications` skeleton — the 5 RLS-scoped tables, the `ChannelAdapter` port, the typed notification catalog, and module registration — so later phases build delivery/SSE/actions on a compiling, migrated, RLS-covered base.

**Architecture:** A new Medusa-style module registered in the api + worker roles. Schema lives in `@baseworks/db` (5 tenant-scoped tables, each with a `tenantRlsPolicy`). The module exposes a `ChannelAdapter` port and a typed `catalog`, but Phase 1 ships **no delivery behavior** — it's the structural base. Behavior-neutral: nothing calls `notify()` yet.

**Tech Stack:** Bun, Drizzle ORM 0.45 (`pgTable`, `pgPolicy`/`pgRole`, jsonb), Postgres 16 RLS, Elysia, TypeBox, `@baseworks/shared` CQRS types, Bun test.

**Spec:** `docs/superpowers/specs/2026-06-25-notification-layer-design.md`

---

## File structure (Phase 1)

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema/notifications.ts` (create) | 5 tables + `tenantRlsPolicy` on each |
| `packages/db/src/schema/index.ts` (modify) | aggregate the new schema |
| `packages/db/migrations/00NN_*.sql` (generated) | tables + ENABLE RLS + policies |
| `packages/modules/notifications/package.json` (create) | module package manifest |
| `packages/modules/notifications/src/channels/channel.ts` (create) | `Channel`, `DeliveryResult`, `ChannelAdapter` port |
| `packages/modules/notifications/src/catalog.ts` (create) | `NotificationType`/`Category`/`Severity`, `CatalogEntry`, `notificationCatalog`, `getCatalogEntry` |
| `packages/modules/notifications/src/index.ts` (create) | `ModuleDefinition` (name + events; commands/queries added later phases) |
| `apps/api/src/core/registry.ts` (modify) | add to `moduleImportMap` |
| `apps/api/src/index.ts` (modify) | add `"notifications"` to the api module list |
| `apps/api/src/worker.ts` (modify) | add `"notifications"` to the worker module list |
| `packages/db/src/__tests__/notifications-rls.test.ts` (create) | RLS isolation proof on `notification` |
| `packages/modules/notifications/src/__tests__/catalog.test.ts` (create) | catalog render + shape |
| `apps/api/src/core/__tests__/registry.test.ts` (modify) | assert the module loads |

---

## Task 1: Module package manifest

**Files:**
- Create: `packages/modules/notifications/package.json`

- [ ] **Step 1: Write the manifest** (mirrors `@baseworks/module-files`)

```json
{
  "name": "@baseworks/module-notifications",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "@baseworks/config": "workspace:*",
    "@baseworks/db": "workspace:*",
    "@baseworks/observability": "workspace:*",
    "@baseworks/queue": "workspace:*",
    "@baseworks/shared": "workspace:*",
    "@sinclair/typebox": "0.34.49",
    "drizzle-orm": "^0.45.0",
    "elysia": "^1.4.0",
    "nanoid": "^5.1.9"
  }
}
```

- [ ] **Step 2: Install so the workspace resolves the new package**

Run: `bun install`
Expected: completes; `@baseworks/module-notifications` linked into the workspace.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/package.json bun.lock
git commit -m "feat(notifications): module package skeleton"
```

## Task 2: Schema — 5 RLS-scoped tables

**Files:**
- Create: `packages/db/src/schema/notifications.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Write the schema**

```ts
// packages/db/src/schema/notifications.ts
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";
import { tenantRlsPolicy } from "./rls";

/** Canonical record + in-app feed item. */
export const notification = pgTable(
  "notification",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    recipientUserId: text("recipient_user_id").notNull(),
    type: text("type").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull(), // info | success | warning | error
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url"),
    data: jsonb("data"),
    actions: jsonb("actions"),
    groupKey: text("group_key"),
    readAt: timestamp("read_at"),
    ...timestampColumns(),
  },
  (t) => [
    index("notification_tenant_recipient_idx").on(t.tenantId, t.recipientUserId),
    index("notification_group_key_idx").on(t.tenantId, t.groupKey),
    tenantRlsPolicy("notification_tenant_isolation", t.tenantId),
  ],
);

/** Per-channel delivery audit. */
export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    notificationId: text("notification_id").notNull(),
    channel: text("channel").notNull(), // in-app | email | webhook
    status: text("status").notNull(), // pending | sent | failed | skipped
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    attempts: text("attempts").notNull().default("0"),
    ...timestampColumns(),
  },
  (t) => [
    index("notification_delivery_notification_idx").on(t.tenantId, t.notificationId),
    tenantRlsPolicy("notification_delivery_tenant_isolation", t.tenantId),
  ],
);

/** Per-user opt-out; absence = catalog default. */
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex("notification_preference_uq").on(t.tenantId, t.userId, t.category, t.channel),
    tenantRlsPolicy("notification_preference_tenant_isolation", t.tenantId),
  ],
);

/** Tenant outbound webhook endpoints. */
export const notificationWebhook = pgTable(
  "notification_webhook",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    categories: jsonb("categories"),
    enabled: boolean("enabled").notNull().default(true),
    ...timestampColumns(),
  },
  (t) => [tenantRlsPolicy("notification_webhook_tenant_isolation", t.tenantId)],
);

/** Idempotency + audit for `once` dispatch actions. */
export const notificationActionExecution = pgTable(
  "notification_action_execution",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    notificationId: text("notification_id").notNull(),
    actionId: text("action_id").notNull(),
    executedBy: text("executed_by").notNull(),
    result: jsonb("result"),
    executedAt: timestamp("executed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_action_execution_uq").on(t.notificationId, t.actionId),
    tenantRlsPolicy("notification_action_execution_tenant_isolation", t.tenantId),
  ],
);
```

- [ ] **Step 2: Aggregate in the schema barrel**

Modify `packages/db/src/schema/index.ts` — add after the `./example` line:

```ts
export * from "./notifications";
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Generate the migration**

Run: `bun run db:generate`
Expected: a new `packages/db/migrations/00NN_*.sql` with `CREATE TABLE` for the 5 tables, `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, and `CREATE POLICY "…_tenant_isolation" … TO "baseworks_rls" USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (…)`.

- [ ] **Step 5: Inspect the generated SQL** — confirm exactly the 5 tables, `TO "baseworks_rls"`, NO `FORCE ROW LEVEL SECURITY`, NO `CREATE ROLE`. If wrong, fix the schema (the `tenantRlsPolicy`/`rlsRole.existing()` are already correct in `./rls`) and regenerate.

- [ ] **Step 6: Provision role grants + apply**

Run: `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev bun run db:setup-rls && bun run db:migrate`
Expected: role re-grant ok (new tables auto-granted via default privileges) + migration applies cleanly.

- [ ] **Step 7: Lint (RLS coverage guard must pass)**

Run: `bun run lint:rls-coverage`
Expected: exit 0 (the 5 new tenant tables all declare a policy).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/notifications.ts packages/db/src/schema/index.ts packages/db/migrations/
git commit -m "feat(notifications): RLS-scoped schema (5 tables)"
```

## Task 3: RLS isolation proof for `notification`

**Files:**
- Create: `packages/db/src/__tests__/notifications-rls.test.ts`

- [ ] **Step 1: Write the test** (mirrors `rls-isolation.test.ts`: skips unless a distinct RLS-role URL is configured)

```ts
// packages/db/src/__tests__/notifications-rls.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getDb, getRlsDb } from "../connection";
import { withTenant } from "../helpers/with-tenant";
import { notification } from "../schema/notifications";

const A = "notif-tenant-A";
const B = "notif-tenant-B";
let ok = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) {
    ok = false;
    return;
  }
  try {
    await getRlsDb().execute(sql`select 1`);
    await getDb()
      .insert(notification)
      .values([
        { tenantId: A, recipientUserId: "u1", type: "t", category: "c", severity: "info", title: "a", body: "a" } as any,
        { tenantId: B, recipientUserId: "u2", type: "t", category: "c", severity: "info", title: "b", body: "b" } as any,
      ]);
    ok = true;
  } catch {
    ok = false;
  }
});

afterAll(async () => {
  if (ok) await getDb().delete(notification).where(sql`tenant_id in (${A}, ${B})`);
});

describe("notification RLS isolation", () => {
  test("RLS role sees only the active tenant's rows", async () => {
    if (!ok) return console.warn("SKIPPED: Postgres/RLS unavailable");
    const rows = await withTenant(getRlsDb(), A, (tx) =>
      tx.execute(sql`select tenant_id from notification`),
    );
    const tenants = new Set((rows as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id));
    expect(tenants.has(A)).toBe(true);
    expect(tenants.has(B)).toBe(false);
  });

  test("RLS role cannot INSERT for another tenant (WITH CHECK)", async () => {
    if (!ok) return console.warn("SKIPPED");
    let threw = false;
    try {
      await withTenant(getRlsDb(), A, (tx) =>
        tx.execute(
          sql`insert into notification (tenant_id, recipient_user_id, type, category, severity, title, body) values (${B}, 'x', 't', 'c', 'info', 'evil', 'evil')`,
        ),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev DATABASE_URL_RLS=postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks bun test packages/db/src/__tests__/notifications-rls.test.ts`
Expected: 2 pass (the WITH CHECK insert is rejected). If the first test sees both tenants, RLS isn't engaging — re-run `db:setup-rls` + `db:migrate` and confirm the test connects as `baseworks_rls`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/__tests__/notifications-rls.test.ts
git commit -m "test(notifications): prove RLS isolation on notification table"
```

## Task 4: `ChannelAdapter` port

**Files:**
- Create: `packages/modules/notifications/src/channels/channel.ts`

- [ ] **Step 1: Write the port**

```ts
// packages/modules/notifications/src/channels/channel.ts

/** Delivery channels. SMS/push added later behind this same union + port. */
export type Channel = "in-app" | "email" | "webhook";

/** Minimal record shape a channel needs to deliver (mirrors the `notification` row). */
export interface DeliverableNotification {
  id: string;
  tenantId: string;
  recipientUserId: string;
  type: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string;
  url?: string | null;
  data?: Record<string, unknown> | null;
  actions?: unknown;
}

/** Outcome of a single channel delivery attempt. */
export type DeliveryResult =
  | { status: "sent"; providerMessageId?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * A delivery channel. Phase 1 defines the port only; adapters land in later
 * phases (in-app inline, email/webhook via the `notifications-deliver` worker).
 */
export interface ChannelAdapter {
  readonly name: Channel;
  deliver(notification: DeliverableNotification, deliveryId: string): Promise<DeliveryResult>;
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/channels/channel.ts
git commit -m "feat(notifications): ChannelAdapter port"
```

## Task 5: Typed catalog scaffold

**Files:**
- Create: `packages/modules/notifications/src/catalog.ts`
- Test: `packages/modules/notifications/src/__tests__/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/__tests__/catalog.test.ts
import { describe, expect, test } from "bun:test";
import { getCatalogEntry, notificationCatalog } from "../catalog";

describe("notification catalog", () => {
  test("every entry has channels, category, severity, and a render()", () => {
    for (const [type, entry] of Object.entries(notificationCatalog)) {
      expect(entry.defaultChannels.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe("string");
      expect(["info", "success", "warning", "error"]).toContain(entry.severity);
      expect(typeof entry.render).toBe("function");
      expect(type.length).toBeGreaterThan(0);
    }
  });

  test("render() returns title + body from data", () => {
    const entry = getCatalogEntry("system.test");
    const rendered = entry.render({ message: "hello" });
    expect(rendered.title.length).toBeGreaterThan(0);
    expect(rendered.body).toContain("hello");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/modules/notifications/src/__tests__/catalog.test.ts`
Expected: FAIL — module `../catalog` not found.

- [ ] **Step 3: Write the catalog**

```ts
// packages/modules/notifications/src/catalog.ts
import type { Channel } from "./channels/channel";

export type Category = "system" | "team" | "billing" | "files" | "security";
export type Severity = "info" | "success" | "warning" | "error";

export interface RenderedContent {
  title: string;
  body: string;
  url?: string;
  // actions are added by producers/later phases; render may seed defaults.
  actions?: unknown[];
}

export interface CatalogEntry {
  category: Category;
  severity: Severity;
  defaultChannels: Channel[];
  /** When true, users cannot opt out (security/transactional). */
  required?: boolean;
  render: (data: Record<string, unknown>) => RenderedContent;
}

/**
 * The notification type catalog. Adding a notification = one entry. Phase 1
 * seeds a single `system.test` entry to validate the shape; real types land
 * with their producers in later phases.
 */
export const notificationCatalog = {
  "system.test": {
    category: "system",
    severity: "info",
    defaultChannels: ["in-app"],
    render: (data) => ({
      title: "System notification",
      body: String((data as { message?: unknown }).message ?? ""),
    }),
  },
} satisfies Record<string, CatalogEntry>;

export type NotificationType = keyof typeof notificationCatalog;

/** Look up a catalog entry; throws on an unknown type (fail-loud for producers). */
export function getCatalogEntry(type: string): CatalogEntry {
  const entry = (notificationCatalog as Record<string, CatalogEntry>)[type];
  if (!entry) throw new Error(`Unknown notification type: "${type}"`);
  return entry;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/modules/notifications/src/__tests__/catalog.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/catalog.ts packages/modules/notifications/src/__tests__/catalog.test.ts
git commit -m "feat(notifications): typed catalog scaffold"
```

## Task 6: ModuleDefinition + registration + load test

**Files:**
- Create: `packages/modules/notifications/src/index.ts`
- Modify: `apps/api/src/core/registry.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/worker.ts`
- Modify: `apps/api/src/core/__tests__/registry.test.ts`

- [ ] **Step 1: Write the module definition** (skeleton — declares the event it will emit; commands/queries/jobs/routes land in later phases)

```ts
// packages/modules/notifications/src/index.ts
import type { ModuleDefinition } from "@baseworks/shared";

export type { Channel, ChannelAdapter, DeliveryResult } from "./channels/channel";
export {
  type CatalogEntry,
  type Category,
  getCatalogEntry,
  type NotificationType,
  notificationCatalog,
  type Severity,
} from "./catalog";

export default {
  name: "notifications",
  events: ["notification.created"],
} satisfies ModuleDefinition;
```

- [ ] **Step 2: Register in the import map**

Modify `apps/api/src/core/registry.ts` `moduleImportMap` — add before the `// Future modules` comment:

```ts
  notifications: () => import("@baseworks/module-notifications"),
```

- [ ] **Step 3: Add to the api + worker module lists**

In `apps/api/src/index.ts`, change the registry `modules` array to include `"notifications"`:

```ts
  modules: ["auth", "billing", "example", "files", "notifications"],
```

In `apps/api/src/worker.ts`, change its `modules` array to include `"notifications"`:

```ts
  modules: ["example", "billing", "files", "notifications"],
```

- [ ] **Step 4: Add a load test**

In `apps/api/src/core/__tests__/registry.test.ts`, add inside the `describe("ModuleRegistry edge cases", …)` block:

```ts
  it("loads the notifications module", async () => {
    const registry = new ModuleRegistry({ role: "api", modules: ["notifications"] });
    await registry.loadAll();
    expect(registry.getLoadedNames()).toContain("notifications");
  });
```

- [ ] **Step 5: Run the load test**

Run: `bun test apps/api/src/core/__tests__/registry.test.ts`
Expected: all pass (including the new case).

- [ ] **Step 6: Full gate**

Run: `bun run typecheck && bun run lint`
Expected: typecheck clean; lint (all guards incl. `rls-coverage` + `tenant-db`) exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/notifications/src/index.ts apps/api/src/core/registry.ts apps/api/src/index.ts apps/api/src/worker.ts apps/api/src/core/__tests__/registry.test.ts
git commit -m "feat(notifications): module definition + registration (api+worker)"
```

---

## Self-review

- **Spec coverage (Phase 1 scope):** 5 tables + RLS (Task 2) ✓; RLS proof (Task 3) ✓; `ChannelAdapter` port (Task 4) ✓; catalog scaffold (Task 5) ✓; module registration api+worker (Task 6) ✓; `lint:rls-coverage` green (Task 2/6) ✓. Delivery/notify/SSE/email/webhook/actions/preferences are explicitly **out of Phase 1** (later plans).
- **Placeholders:** none — every step has concrete code/SQL/commands.
- **Type consistency:** `Channel`/`DeliveryResult`/`ChannelAdapter` (Task 4) are re-exported by `index.ts` (Task 6); `Category`/`Severity`/`CatalogEntry`/`NotificationType`/`notificationCatalog`/`getCatalogEntry` (Task 5) match the test (Task 5) and the re-exports (Task 6); table names match the spec's data model.
- **Open items for the implementer to confirm against live code (verifications, not placeholders):** the generated migration number (`00NN`), and that `db:generate` emits the policy SQL in the `TO "baseworks_rls"` / no-`FORCE` shape (Task 2 Steps 5–7 verify this).

## Phasing note

Phases 2–6 (notify + in-app + SSE; email channel + billing migration; webhooks; actions; preferences + web UI) get their own plans authored once Phase 1's real code exists — their task detail depends on the concrete schema/port/catalog shipped here. Each ships as its own PR via the gated multi-agent Workflow.
