# Notification Layer Phase 4d — Webhook Admin Oversight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give platform staff a cross-tenant webhook oversight view in `apps/admin`: search/filter every tenant's endpoints by URL/tenant/status, drill into a webhook's delivery history, and force-disable an endpoint (abuse response).

**Architecture:** New **platform-admin backend functions** — plain `Result`-returning async functions (NOT `defineCommand`/`defineQuery`) taking explicit ids, using the owner (non-RLS) `getDb` handle, mirroring `packages/modules/files/src/commands/admin-files.ts`. They live in the notifications module, are re-exported, and are wired into `apps/api/src/routes/admin.ts` under the existing `requirePlatformAdmin()` gate. The `apps/admin` SPA consumes them via Eden (`api.api.admin.webhooks…`) on a new React-Router page that mirrors the users/tenants list pages (react-table `DataTable`, debounced search, status `Select`, Dialog-based confirm, a deliveries Dialog).

**Tech Stack:** Elysia, Drizzle (owner `getDb`), `@baseworks/shared` `ok`/`err`, Vite + React Router 7, `@tanstack/react-query`, `@tanstack/react-table` (`DataTable`), `@baseworks/ui` (shadcn), `sonner`, next… no — react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-29-notification-layer-phase-4-webhooks-design.md` (`apps/admin` — platform oversight)
**Branch:** create `feat/notifications-phase-4d` off `main`.
**Depends on:** Phase 4a/4b/4c (merged).
**Out of scope:** changing the tenant-facing re-enable behaviour (see Decisions).

## Conventions (verified in-repo)

- **Auth band:** `requirePlatformAdmin()` (from `@baseworks/module-auth`) gates all `/api/admin/*` routes by the user's global role against `platformAdminRoles` (`["admin"]`). New routes added to the existing `adminRoutes` chain inherit it.
- **Cross-tenant DB:** the owner pool `getDb(env.DATABASE_URL)` bypasses RLS. In a module `commands/` file, every `getDb(` line MUST carry a trailing `// scoped-db-allow: <reason>` comment or `lint:tenant-db` fails. Integration tests under `src/__integration__/` are NOT scanned (no annotation needed there).
- **Admin functions** return `ok(...)`/`err("CODE")`; the route maps `!success` → HTTP 400, else returns `result.data`. Admin list routes return `{ data, total }` directly (no envelope), so the SPA reads `res.data` / `(result as any)?.data`.
- **Eden in admin:** `import { api } from "@/lib/api"`; dynamic params use the `(api.api.admin.X as any)({ id })` cast (envelope types unexposed). Auth is cookie-based (`credentials: include`).
- **React Query keys:** `["admin", "webhooks", page, search, status]` for the list, `["admin", "webhooks", id, "deliveries"]` for the drill-in; invalidate `["admin", "webhooks"]` after force-disable.
- **Tables:** the shared `DataTable` (`@/components/data-table`) with `manualPagination`; columns are `ColumnDef<Row, any>[]` with `meta: { priority | cardHidden }`.
- **Confirm dialogs:** controlled `Dialog` gated by a `*Target` state object (NO `window.confirm`, NO `AlertDialog` component exists). Toast via `sonner`.
- **i18n:** `useTranslation("admin")` (`t`) + `useTranslation("common")` (`tc`). Strings live in `packages/i18n/src/locales/{en,pt-BR}/admin.json`.

## Decisions

- **Force-disable semantics:** set `status='auto_disabled'` + `disabledReason='Force-disabled by platform admin: <reason>'`. This reuses the system lockout state (distinct from a tenant's voluntary `'disabled'`), and the reason text records the operator action. **Known limitation (deliberate, v1):** a tenant can still re-enable via the 4c UI (which resets on `status='active'`). A non-reversible operator lockout would require changing the 4c re-enable logic and is a flagged follow-up, not in 4d.
- **Cross-tenant list:** owner `getDb`, `LEFT JOIN organization` for the tenant name (orphan `tenantId` still shows — oversight must not hide rows), filter by URL/tenant-name search + status, server-paginated.
- **Force-disable keys on the global webhook id** (uuid PK, unique across tenants) — no `targetTenantId` needed; route is gated by `requirePlatformAdmin()`.

## Test strategy

- **Backend:** integration test in `packages/modules/notifications/src/__integration__/admin-webhooks.test.ts` (gated on `DATABASE_URL`, `bun test`). Functions return `ok`/`err`, so assertions use `result.success` — never `.rejects` on a live-DB promise.
- **Frontend:** a Vitest render test for the list page mirroring `apps/admin/src/routes/jobs.test.tsx` (mock `react-i18next`, `sonner`, `@/lib/api`, `@baseworks/ui`, `@/components/data-table`, and the deliveries dialog; wrap in a real `QueryClientProvider`).

---

## File Structure

**Create:**
- `packages/modules/notifications/src/commands/admin-webhooks.ts` — `adminListAllWebhooks`, `adminListWebhookDeliveries`, `adminForceDisableWebhook` (+ `AdminWebhookRow` type).
- `packages/modules/notifications/src/__integration__/admin-webhooks.test.ts`
- `apps/admin/src/routes/webhooks/list.tsx` — the oversight page (`export function Component()`).
- `apps/admin/src/routes/webhooks/deliveries-dialog.tsx` — the delivery-history drill-in.
- `apps/admin/src/routes/webhooks/list.test.tsx`

**Modify:**
- `packages/modules/notifications/src/index.ts` — re-export the three admin functions.
- `apps/api/src/routes/admin.ts` — mount `/webhooks`, `/webhooks/:id/deliveries`, `/webhooks/:id/disable`.
- `packages/i18n/src/locales/en/admin.json` + `pt-BR/admin.json` — `nav.webhooks` + `webhooks.*`.
- `apps/admin/src/lib/router.ts` — add the `webhooks` route.
- `apps/admin/src/layouts/admin-layout.tsx` — add the Webhooks nav item.

---

## Task 1: Backend admin webhook functions (+ integration test)

**Files:**
- Create: `packages/modules/notifications/src/commands/admin-webhooks.ts`
- Test: `packages/modules/notifications/src/__integration__/admin-webhooks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/__integration__/admin-webhooks.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { env } from "@baseworks/config";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, inArray, sql } from "drizzle-orm";
import {
  adminForceDisableWebhook,
  adminListAllWebhooks,
  adminListWebhookDeliveries,
} from "../commands/admin-webhooks";

const TA = "admin-wh-it-tenant-a";
const TB = "admin-wh-it-tenant-b";
const db = () => getDb(env.DATABASE_URL);
let ready = false;
let idA = "";
let idB = "";

beforeAll(async () => {
  if (!env.DATABASE_URL) return;
  try {
    await db().execute(sql`select 1`);
    const [a] = await db()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({ tenantId: TA, url: "https://a.example.com/hook", secret: "s", categories: ["system"], status: "active" } as any)
      .returning();
    const [b] = await db()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({ tenantId: TB, url: "https://b.example.com/hook", secret: "s", categories: ["billing"], status: "disabled" } as any)
      .returning();
    idA = a.id;
    idB = b.id;
    await db()
      .insert(notificationWebhookDelivery)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({ tenantId: TA, webhookId: a.id, eventType: "system.test", category: "system", payload: { event: "system.test" }, status: "failed" } as any);
    ready = true;
  } catch {
    ready = false;
  }
});

afterAll(async () => {
  if (!ready) return;
  await db().delete(notificationWebhookDelivery).where(inArray(notificationWebhookDelivery.tenantId, [TA, TB]));
  await db().delete(notificationWebhook).where(inArray(notificationWebhook.tenantId, [TA, TB]));
});

describe("admin webhook oversight", () => {
  test("lists webhooks across tenants", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminListAllWebhooks({ limit: 100, offset: 0 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    const ids = res.data.data.map((r) => r.id);
    expect(ids).toContain(idA);
    expect(ids).toContain(idB);
  }, 30000);

  test("filters by status", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminListAllWebhooks({ status: "disabled", limit: 100, offset: 0 });
    if (!res.success) return;
    const ids = res.data.data.map((r) => r.id);
    expect(ids).toContain(idB);
    expect(ids).not.toContain(idA);
  }, 30000);

  test("lists a webhook's deliveries cross-tenant", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminListWebhookDeliveries(idA, { limit: 100, offset: 0 });
    if (!res.success) return;
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  test("force-disable flips status + records reason", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminForceDisableWebhook(idA, "spam");
    expect(res.success).toBe(true);
    const [row] = await db().select().from(notificationWebhook).where(eq(notificationWebhook.id, idA));
    expect(row.status).toBe("auto_disabled");
    expect(row.disabledReason).toContain("platform admin");
  }, 30000);

  test("force-disable of an unknown id returns an error", async () => {
    if (!ready) return console.warn("SKIPPED");
    const res = await adminForceDisableWebhook("00000000-0000-0000-0000-000000000000", "x");
    expect(res.success).toBe(false);
  }, 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/__integration__/admin-webhooks.test.ts`
Expected: FAIL — `Cannot find module ../commands/admin-webhooks` (or SKIPPED if no `DATABASE_URL`, in which case proceed; the implementation step is still required).

- [ ] **Step 3: Write the implementation**

```ts
// packages/modules/notifications/src/commands/admin-webhooks.ts
import { env } from "@baseworks/config";
import {
  getDb,
  notificationWebhook,
  notificationWebhookDelivery,
  organization,
} from "@baseworks/db";
import { err, ok } from "@baseworks/shared";
import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";

/** Escape LIKE meta-characters to prevent search injection. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export interface AdminWebhookRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  url: string;
  categories: string[] | null;
  status: string;
  consecutiveFailures: string;
  lastStatus: string | null;
  lastDeliveryAt: Date | null;
  disabledReason: string | null;
  createdAt: Date;
}

/**
 * Cross-tenant list of every webhook endpoint for platform oversight. Owner db
 * (no RLS); authorization is enforced at the route by requirePlatformAdmin().
 * LEFT JOINs organization for the tenant name so an orphan tenantId still shows.
 */
export async function adminListAllWebhooks(opts: {
  search?: string;
  status?: string;
  limit: number;
  offset: number;
}) {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant oversight — gated by requirePlatformAdmin
  const conds: SQL[] = [];
  if (opts.status) conds.push(eq(notificationWebhook.status, opts.status));
  if (opts.search) {
    const s = `%${escapeLike(opts.search)}%`;
    const m = or(like(notificationWebhook.url, s), like(organization.name, s));
    if (m) conds.push(m);
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = (await db
    .select({
      id: notificationWebhook.id,
      tenantId: notificationWebhook.tenantId,
      tenantName: organization.name,
      url: notificationWebhook.url,
      categories: notificationWebhook.categories,
      status: notificationWebhook.status,
      consecutiveFailures: notificationWebhook.consecutiveFailures,
      lastStatus: notificationWebhook.lastStatus,
      lastDeliveryAt: notificationWebhook.lastDeliveryAt,
      disabledReason: notificationWebhook.disabledReason,
      createdAt: notificationWebhook.createdAt,
    })
    .from(notificationWebhook)
    .leftJoin(organization, eq(organization.id, notificationWebhook.tenantId))
    .where(where)
    .orderBy(desc(notificationWebhook.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)) as AdminWebhookRow[];

  const [totalRow] = await db
    .select({ value: count() })
    .from(notificationWebhook)
    .leftJoin(organization, eq(organization.id, notificationWebhook.tenantId))
    .where(where);

  return ok({ data: rows, total: totalRow?.value ?? 0 });
}

/** Cross-tenant delivery history for one webhook (owner db, gated at the route). */
export async function adminListWebhookDeliveries(
  webhookId: string,
  opts: { limit: number; offset: number },
) {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant oversight — gated by requirePlatformAdmin
  const rows = await db
    .select()
    .from(notificationWebhookDelivery)
    .where(eq(notificationWebhookDelivery.webhookId, webhookId))
    .orderBy(desc(notificationWebhookDelivery.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  const [totalRow] = await db
    .select({ value: count() })
    .from(notificationWebhookDelivery)
    .where(eq(notificationWebhookDelivery.webhookId, webhookId));
  return ok({ data: rows, total: totalRow?.value ?? 0 });
}

/**
 * Force-disable a webhook (abuse response). Sets status='auto_disabled' and
 * records the operator reason. Owner db; gated at the route. Keys on the global
 * webhook id (uuid PK), so no tenant param is required.
 */
export async function adminForceDisableWebhook(webhookId: string, reason: string) {
  const db = getDb(env.DATABASE_URL); // scoped-db-allow: operator cross-tenant moderation — gated by requirePlatformAdmin
  const trimmed = (reason ?? "").trim();
  const disabledReason = trimmed
    ? `Force-disabled by platform admin: ${trimmed}`
    : "Force-disabled by platform admin";
  const updated = await db
    .update(notificationWebhook)
    .set({ status: "auto_disabled", disabledReason })
    .where(eq(notificationWebhook.id, webhookId))
    .returning({ id: notificationWebhook.id });
  if (updated.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok({ id: webhookId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/__integration__/admin-webhooks.test.ts`
Expected: PASS (or SKIPPED without `DATABASE_URL`).

- [ ] **Step 5: Lint the new cross-tenant access**

Run: `bun run lint:tenant-db && bun run lint:rls-coverage`
Expected: PASS (the `// scoped-db-allow:` annotations satisfy `lint:tenant-db`).

- [ ] **Step 6: Commit**

```bash
git add packages/modules/notifications/src/commands/admin-webhooks.ts packages/modules/notifications/src/__integration__/admin-webhooks.test.ts
git commit -m "feat(notifications): admin cross-tenant webhook oversight functions"
```

---

## Task 2: Re-export admin functions from the module

**Files:**
- Modify: `packages/modules/notifications/src/index.ts`

- [ ] **Step 1: Add the re-export**

Add near the other notifications exports in `packages/modules/notifications/src/index.ts` (mirroring how `files/src/index.ts` re-exports its `admin*` functions):

```ts
export {
  adminForceDisableWebhook,
  adminListAllWebhooks,
  adminListWebhookDeliveries,
  type AdminWebhookRow,
} from "./commands/admin-webhooks";
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/index.ts
git commit -m "feat(notifications): export admin webhook functions from module barrel"
```

---

## Task 3: Admin API routes

**Files:**
- Modify: `apps/api/src/routes/admin.ts`

- [ ] **Step 1: Import the functions**

In `apps/api/src/routes/admin.ts`, add to the `@baseworks/module-*` imports (the notifications module's package name is `@baseworks/module-notifications` — verify against `apps/api/package.json` deps / how other modules are imported in this file and match exactly):

```ts
import {
  adminForceDisableWebhook,
  adminListAllWebhooks,
  adminListWebhookDeliveries,
} from "@baseworks/module-notifications";
```

- [ ] **Step 2: Add the routes**

Append these to the `adminRoutes` chain (anywhere after `.use(requirePlatformAdmin())`, alongside the other resource groups), using the same `ctx: any` + query-coercion style as the existing `/tenants` route:

```ts
  // --- Webhook Oversight (cross-tenant) ---
  .get("/webhooks", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const search = ctx.query?.search as string | undefined;
    const status = ctx.query?.status as string | undefined;
    const result = await adminListAllWebhooks({ search, status, limit, offset });
    if (!result.success) {
      ctx.set.status = 400;
      return result;
    }
    return result.data;
  })
  .get("/webhooks/:id/deliveries", async (ctx: any) => {
    const limit = Number(ctx.query?.limit) || 20;
    const offset = Number(ctx.query?.offset) || 0;
    const result = await adminListWebhookDeliveries(ctx.params.id, { limit, offset });
    if (!result.success) {
      ctx.set.status = 400;
      return result;
    }
    return result.data;
  })
  .patch("/webhooks/:id/disable", async (ctx: any) => {
    const reason = (ctx.body?.reason as string) ?? "";
    const result = await adminForceDisableWebhook(ctx.params.id, reason);
    if (!result.success) {
      ctx.set.status = 400;
      return result;
    }
    return result.data;
  })
```

- [ ] **Step 3: Typecheck + targeted API test**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun test apps/api/src/__tests__/admin-roles.test.ts`
Expected: PASS (confirms the admin route plugin still composes; no regression).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin.ts
git commit -m "feat(api): admin webhook oversight routes (list, deliveries, force-disable)"
```

---

## Task 4: i18n strings (admin namespace)

**Files:**
- Modify: `packages/i18n/src/locales/en/admin.json`, `packages/i18n/src/locales/pt-BR/admin.json`

- [ ] **Step 1: Add `nav.webhooks`**

In the `"nav"` object of `en/admin.json` add `"webhooks": "Webhooks"`; in `pt-BR/admin.json` add `"webhooks": "Webhooks"`.

- [ ] **Step 2: Add the `webhooks` block to `en/admin.json`** (sibling to `tenants`)

```json
  "webhooks": {
    "title": "Webhooks",
    "searchPlaceholder": "Search by URL or tenant",
    "empty": "No webhook endpoints across any tenant.",
    "loadError": "Failed to load webhooks.",
    "columns": {
      "tenant": "Tenant",
      "url": "Endpoint URL",
      "categories": "Categories",
      "status": "Status",
      "failures": "Failures",
      "lastDelivery": "Last delivery"
    },
    "status": { "active": "Active", "disabled": "Disabled", "autoDisabled": "Auto-disabled" },
    "filter": {
      "label": "Status",
      "all": "All statuses",
      "active": "Active",
      "disabled": "Disabled",
      "autoDisabled": "Auto-disabled"
    },
    "actions": { "viewDeliveries": "View deliveries", "forceDisable": "Force-disable" },
    "deliveries": {
      "title": "Deliveries",
      "empty": "No deliveries yet.",
      "event": "Event",
      "status": "Status",
      "code": "Code",
      "attempts": "Attempts"
    },
    "disableDialog": {
      "title": "Force-disable webhook",
      "description": "Disable {url}? The tenant stops receiving callbacks until they re-enable it.",
      "reasonLabel": "Reason (optional)",
      "cancel": "Cancel",
      "confirm": "Force-disable",
      "disabling": "Disabling…"
    },
    "toast": { "disabled": "Webhook force-disabled", "disableFailed": "Failed to disable webhook" }
  }
```

- [ ] **Step 3: Add the same block (translated) to `pt-BR/admin.json`**

```json
  "webhooks": {
    "title": "Webhooks",
    "searchPlaceholder": "Buscar por URL ou tenant",
    "empty": "Nenhum endpoint de webhook em nenhum tenant.",
    "loadError": "Falha ao carregar webhooks.",
    "columns": {
      "tenant": "Tenant",
      "url": "URL do endpoint",
      "categories": "Categorias",
      "status": "Status",
      "failures": "Falhas",
      "lastDelivery": "Última entrega"
    },
    "status": { "active": "Ativo", "disabled": "Desativado", "autoDisabled": "Desativado automaticamente" },
    "filter": {
      "label": "Status",
      "all": "Todos os status",
      "active": "Ativo",
      "disabled": "Desativado",
      "autoDisabled": "Desativado automaticamente"
    },
    "actions": { "viewDeliveries": "Ver entregas", "forceDisable": "Forçar desativação" },
    "deliveries": {
      "title": "Entregas",
      "empty": "Nenhuma entrega ainda.",
      "event": "Evento",
      "status": "Status",
      "code": "Código",
      "attempts": "Tentativas"
    },
    "disableDialog": {
      "title": "Forçar desativação do webhook",
      "description": "Desativar {url}? O tenant deixa de receber callbacks até reativá-lo.",
      "reasonLabel": "Motivo (opcional)",
      "cancel": "Cancelar",
      "confirm": "Forçar desativação",
      "disabling": "Desativando…"
    },
    "toast": { "disabled": "Webhook desativado", "disableFailed": "Falha ao desativar webhook" }
  }
```

- [ ] **Step 4: Validate JSON**

Run: `bunx biome check packages/i18n/src/locales` → clean. Run: `bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/locales/en/admin.json packages/i18n/src/locales/pt-BR/admin.json
git commit -m "feat(i18n): admin webhook oversight strings (en + pt-BR)"
```

---

## Task 5: Deliveries drill-in dialog

**Files:**
- Create: `apps/admin/src/routes/webhooks/deliveries-dialog.tsx`

- [ ] **Step 1: Write the implementation**

```tsx
// apps/admin/src/routes/webhooks/deliveries-dialog.tsx
import {
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

interface Delivery {
  id: string;
  eventType: string;
  status: string;
  httpStatus: string | null;
  attempts: string;
}

function statusVariant(s: string): "default" | "secondary" | "destructive" {
  if (s === "success") return "default";
  if (s === "failed") return "destructive";
  return "secondary";
}

export function WebhookDeliveriesDialog({
  webhookId,
  onClose,
}: {
  webhookId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "webhooks", webhookId, "deliveries"],
    queryFn: async () => {
      const res = await (api.api.admin.webhooks as any)({ id: webhookId }).deliveries.get({
        query: { limit: 50, offset: 0 },
      });
      if (res.error) throw res.error;
      return res.data;
    },
    enabled: !!webhookId,
  });

  const deliveries: Delivery[] = (data as any)?.data ?? [];

  return (
    <Dialog open={!!webhookId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("webhooks.deliveries.title")}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("webhooks.deliveries.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("webhooks.deliveries.event")}</TableHead>
                <TableHead scope="col">{t("webhooks.deliveries.status")}</TableHead>
                <TableHead scope="col">{t("webhooks.deliveries.code")}</TableHead>
                <TableHead scope="col">{t("webhooks.deliveries.attempts")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.eventType}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                  </TableCell>
                  <TableCell>{d.httpStatus ?? "—"}</TableCell>
                  <TableCell>{d.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (note: `api.api.admin.webhooks` resolves because Task 3 added the routes and `App` type re-exports through Eden).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/routes/webhooks/deliveries-dialog.tsx
git commit -m "feat(admin): webhook deliveries drill-in dialog"
```

---

## Task 6: Oversight list page (+ test)

**Files:**
- Create: `apps/admin/src/routes/webhooks/list.tsx`
- Test: `apps/admin/src/routes/webhooks/list.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/admin/src/routes/webhooks/list.test.tsx
/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: (ns: string) => ({ t: (k: string) => `${ns}:${k}` }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./deliveries-dialog", () => ({ WebhookDeliveriesDialog: () => null }));

// Surface row count without the full table surface.
vi.mock("@/components/data-table", () => ({
  DataTable: ({ data }: any) => <div data-testid="rows">{data.length}</div>,
}));

// Minimal stubs for the shadcn components the page imports.
vi.mock("@baseworks/ui", () => {
  const Pass = ({ children, ...p }: any) => <div {...p}>{children}</div>;
  const Btn = ({ children, onClick, ...p }: any) => (
    <button onClick={onClick} {...p}>
      {children}
    </button>
  );
  return {
    Badge: Pass,
    Button: Btn,
    Card: Pass,
    CardContent: Pass,
    Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
    DialogContent: Pass,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogTitle: Pass,
    DropdownMenu: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Btn,
    DropdownMenuTrigger: Pass,
    Input: (p: any) => <input {...p} />,
    Label: Pass,
    Select: Pass,
    SelectContent: Pass,
    SelectItem: Pass,
    SelectTrigger: Pass,
    SelectValue: Pass,
  };
});

const getMock = vi.fn(async () => ({
  data: {
    data: [
      { id: "w1", tenantId: "t1", tenantName: "Tenant One", url: "https://a/b", categories: ["system"], status: "active", consecutiveFailures: "0", lastStatus: null, lastDeliveryAt: null, disabledReason: null, createdAt: "2026-01-01" },
      { id: "w2", tenantId: "t2", tenantName: "Tenant Two", url: "https://c/d", categories: ["billing"], status: "auto_disabled", consecutiveFailures: "15", lastStatus: "failed", lastDeliveryAt: null, disabledReason: "x", createdAt: "2026-01-01" },
    ],
    total: 2,
  },
  error: null,
}));
vi.mock("@/lib/api", () => ({
  api: { api: { admin: { webhooks: { get: (...a: any[]) => getMock(...a) } } } },
}));

let Component: React.ComponentType;
beforeEach(async () => {
  vi.clearAllMocks();
  Component = (await import("./list")).Component;
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("/webhooks admin oversight route", () => {
  test("renders heading and loads cross-tenant rows", async () => {
    wrap(<Component />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("admin:webhooks.title");
    await waitFor(() => expect(screen.getByTestId("rows").textContent).toBe("2"));
    expect(getMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/admin && bunx vitest run src/routes/webhooks/list.test.tsx`
Expected: FAIL — `Cannot find module ./list`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/admin/src/routes/webhooks/list.tsx
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@baseworks/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";
import { WebhookDeliveriesDialog } from "./deliveries-dialog";

interface WebhookRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  url: string;
  categories: string[] | null;
  status: string;
  consecutiveFailures: string;
  lastStatus: string | null;
  lastDeliveryAt: string | null;
  disabledReason: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "active") return <Badge variant="default">{t("webhooks.status.active")}</Badge>;
  if (status === "disabled")
    return <Badge variant="secondary">{t("webhooks.status.disabled")}</Badge>;
  return <Badge variant="destructive">{t("webhooks.status.autoDisabled")}</Badge>;
}

export function Component() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [disableTarget, setDisableTarget] = useState<WebhookRow | null>(null);
  const [reason, setReason] = useState("");
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "webhooks", page, search, status],
    queryFn: async () => {
      const res = await api.api.admin.webhooks.get({
        query: {
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          search,
          ...(status !== "all" ? { status } : {}),
        },
      });
      if (res.error) throw res.error;
      return res.data;
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (target: WebhookRow) => {
      const res = await (api.api.admin.webhooks as any)({ id: target.id }).disable.patch({ reason });
      if (res.error) throw new Error(res.error?.value?.message ?? "request failed");
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("webhooks.toast.disabled"));
      queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
      setDisableTarget(null);
      setReason("");
    },
    onError: () => {
      toast.error(t("webhooks.toast.disableFailed"));
    },
  });

  const rows = (result as any)?.data ?? [];
  const total = (result as any)?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<WebhookRow, any>[] = [
    {
      accessorKey: "tenantName",
      header: t("webhooks.columns.tenant"),
      cell: ({ row }) => row.original.tenantName ?? row.original.tenantId,
      meta: { priority: 1 },
    },
    {
      accessorKey: "url",
      header: t("webhooks.columns.url"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.url}</span>,
      meta: { priority: 2 },
    },
    {
      id: "categories",
      header: t("webhooks.columns.categories"),
      cell: ({ row }) => (row.original.categories ?? []).join(", "),
      meta: { priority: 3 },
    },
    {
      id: "status",
      header: t("webhooks.columns.status"),
      cell: ({ row }) => statusBadge(row.original.status, t),
      meta: { priority: 1 },
    },
    {
      accessorKey: "consecutiveFailures",
      header: t("webhooks.columns.failures"),
      meta: { priority: 3 },
    },
    {
      id: "actions",
      header: "",
      meta: { cardHidden: true },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">{tc("openMenu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDeliveriesFor(row.original.id)}>
              {t("webhooks.actions.viewDeliveries")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDisableTarget(row.original)}
              className="text-destructive"
            >
              {t("webhooks.actions.forceDisable")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("webhooks.title")}</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">{t("webhooks.loadError")}</p>
            <Button variant="outline" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("webhooks.title")}</h1>

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">{t("webhooks.filter.label")}</Label>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("webhooks.filter.all")}</SelectItem>
            <SelectItem value="active">{t("webhooks.filter.active")}</SelectItem>
            <SelectItem value="disabled">{t("webhooks.filter.disabled")}</SelectItem>
            <SelectItem value="auto_disabled">{t("webhooks.filter.autoDisabled")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isLoading && rows.length === 0 && !search && status === "all" ? (
        <p className="text-sm text-muted-foreground py-12 text-center">{t("webhooks.empty")}</p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={t("webhooks.searchPlaceholder")}
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          pageCount={pageCount}
          pageIndex={page}
          onPaginationChange={setPage}
        />
      )}

      <WebhookDeliveriesDialog webhookId={deliveriesFor} onClose={() => setDeliveriesFor(null)} />

      <Dialog
        open={!!disableTarget}
        onOpenChange={() => {
          setDisableTarget(null);
          setReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("webhooks.disableDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("webhooks.disableDialog.description", { url: disableTarget?.url })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disable-reason">{t("webhooks.disableDialog.reasonLabel")}</Label>
            <Input
              id="disable-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setDisableTarget(null);
                setReason("");
              }}
            >
              {t("webhooks.disableDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => disableTarget && disableMutation.mutate(disableTarget)}
              disabled={disableMutation.isPending}
            >
              {disableMutation.isPending
                ? t("webhooks.disableDialog.disabling")
                : t("webhooks.disableDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/admin && bunx vitest run src/routes/webhooks/list.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/routes/webhooks/list.tsx apps/admin/src/routes/webhooks/list.test.tsx
git commit -m "feat(admin): webhook oversight list page (filter, force-disable, deliveries)"
```

---

## Task 7: Router + sidebar nav

**Files:**
- Modify: `apps/admin/src/lib/router.ts`
- Modify: `apps/admin/src/layouts/admin-layout.tsx`

- [ ] **Step 1: Register the route**

In `apps/admin/src/lib/router.ts`, add to the `children` array of the `path: "/"` route (next to `users`):

```ts
      { path: "webhooks", lazy: () => import("../routes/webhooks/list") },
```

- [ ] **Step 2: Add the nav item**

In `apps/admin/src/layouts/admin-layout.tsx`:
- Add `Webhook` to the `lucide-react` import.
- Add to the `navItems` array: `{ titleKey: "nav.webhooks", icon: Webhook, href: "/webhooks" },`.

- [ ] **Step 3: Typecheck + lint**

Run: `bun run typecheck`
Expected: PASS.
Run: `bunx biome check apps/admin/src/routes/webhooks apps/admin/src/lib/router.ts apps/admin/src/layouts/admin-layout.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/router.ts apps/admin/src/layouts/admin-layout.tsx
git commit -m "feat(admin): register webhooks route + sidebar nav"
```

---

## Task 8: Verify

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the workspace**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2: Backend tests**

Run: `bun test packages/modules/notifications`
Expected: PASS (admin-webhooks integration tests run with `DATABASE_URL`, else SKIPPED).

- [ ] **Step 3: Admin test suite**

Run: `cd apps/admin && bunx vitest run`
Expected: PASS (includes the new `webhooks/list` test).

- [ ] **Step 4: Lint (full — includes tenant-db + rls-coverage + cross-module)**

Run: `bun run lint:tenant-db && bun run lint:rls-coverage && bun run lint:cross-module`
Expected: PASS.
Run: `bunx biome check apps/admin/src packages/modules/notifications/src apps/api/src/routes/admin.ts`
Expected: clean (pre-existing warnings only).

- [ ] **Step 5: Admin production build**

Run: `bun run build:admin` (root script → `cd apps/admin && tsc -b && vite build`)
Expected: build succeeds.

- [ ] **Step 6: Commit (if any lint/format fixes were applied)**

```bash
git add -A
git commit -m "chore: lint/format fixes for webhook admin oversight" || echo "nothing to commit"
```

---

## Self-Review Notes (for the implementer)

- **Force-disable is reversible in v1.** It sets `status='auto_disabled'` + `disabledReason`; a tenant can re-enable through the 4c UI (which resets on `status='active'`). A true operator lockout (block tenant re-enable) needs a 4c logic change and is OUT of scope — flagged for follow-up. Do not silently add a new status value or change 4c here.
- **`scoped-db-allow` is mandatory.** Every `getDb(` in `commands/admin-webhooks.ts` carries the annotation; `lint:tenant-db` fails without it. The integration test under `__integration__/` is not scanned.
- **Authorization lives at the route, not the function** (confused-deputy convention from `admin-files.ts`). The functions trust their args; `requirePlatformAdmin()` on `adminRoutes` is the gate. Never read a target id from a request body where a path/global id is the authority.
- **Module package name:** confirm the import specifier for the notifications module in `apps/api` (e.g. `@baseworks/module-notifications`) against how the file already imports `@baseworks/module-files` / `@baseworks/module-auth` and `apps/api/package.json`.
- **Eden typing:** `api.api.admin.webhooks.get(...)` only typechecks after Task 3; dynamic-param calls use the `(... as any)({ id })` cast like the existing users/tenants mutations.
- **No `.rejects` on live-DB promises** (project memory): backend tests assert `result.success`. Frontend tests mock the api — no live DB.
- **Visual QA is manual** (admin SPA): after merge, sign in as a platform admin (`ADMIN_EMAILS`), open `/webhooks`, verify the cross-tenant list, status filter, deliveries drill-in, and force-disable confirm flow.
