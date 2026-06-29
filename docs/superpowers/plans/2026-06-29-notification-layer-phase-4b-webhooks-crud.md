# Notification Layer Phase 4b — Webhook Endpoint CRUD API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tenants an API to manage outbound webhook endpoints — create / list / update / delete / rotate-secret, plus delivery-history listing and redelivery — on top of the Phase 4a backend.

**Architecture:** CQRS commands/queries (`defineCommand`/`defineQuery`), RLS-scoped via `requireWithTenant`, mounted as Elysia routes under `/api/notifications/webhooks` and invoked with `ctx.handlerCtx` (the existing module pattern). The secret is write-once (returned only on create + rotate, never on reads). URL registration reuses the Phase 4a `assertSafeWebhookUrl` SSRF guard. Redelivery clones a past delivery's stored `payload` into a new pending row and enqueues it onto `notifications-webhook`.

**Tech Stack:** Bun, Elysia + Eden Treaty, Drizzle (postgres.js), TypeBox, `nanoid`, `bun test`.

**Spec:** `docs/superpowers/specs/2026-06-29-notification-layer-phase-4-webhooks-design.md` (Endpoint Management API section)
**Branch:** create `feat/notifications-phase-4b` off `main`.
**Depends on:** Phase 4a (merged) — schema, `assertSafeWebhookUrl`, `getWebhookQueue`, the `notification_webhook` / `notification_webhook_delivery` tables.
**Out of scope:** web UI (4c), admin UI (4d).

## Decisions

- **Auth scope:** tenant-scoped via `handlerCtx` + RLS (any authenticated tenant member). Admin-only role-gating is a recommended follow-up once broader RBAC is wired; not in 4b. Flagged in the self-review.
- **Secret:** `whsec_<nanoid(32)>`, returned ONLY from create + rotate; every read omits it.
- **Categories:** validated as a subset of `{system, team, billing, files, security}`.
- **Update status:** tenant may set `active` | `disabled`; re-enabling (→ `active`) resets `consecutiveFailures` to `"0"` (clears an `auto_disabled` lockout). Tenants cannot set `auto_disabled` directly.
- **Delete:** removes the endpoint and cascades its delivery rows (delete by `webhookId`).
- **Redeliver:** clones the source delivery (`webhookId`/`eventType`/`category`/`payload`) into a NEW `pending` row and enqueues it — preserving the original audit row. Errors if no queue (no `REDIS_URL`).
- **Error signaling:** expected failures return `err("CODE")`; routes set HTTP 400 on `result.success === false` (existing pattern). Unexpected errors propagate to error middleware.

## Test strategy

- **Pure helpers** (`lib/webhook-endpoint.ts`): unit tests (no DB).
- **Commands/queries:** integration tests against the live DB (gated on `DATABASE_URL_RLS`, mirroring `__integration__/notify.test.ts`). They return `err()` (not throw) for business failures, so assertions use `result.success` — avoiding the `expect().rejects` + live-DB hang documented for this repo.
- URL validation in tests: a public host (`https://example.com/...`) passes; `https://localhost/...` (resolves 127.0.0.1, no network) and `http://...` are rejected.

---

## File Structure

**Create:**
- `packages/modules/notifications/src/lib/webhook-endpoint.ts` — `KNOWN_CATEGORIES`, `isValidCategories`, `generateWebhookSecret`, `serializeWebhook` (strips secret).
- `packages/modules/notifications/src/commands/create-webhook.ts`
- `packages/modules/notifications/src/queries/list-webhooks.ts`
- `packages/modules/notifications/src/commands/update-webhook.ts`
- `packages/modules/notifications/src/commands/delete-webhook.ts`
- `packages/modules/notifications/src/commands/rotate-webhook-secret.ts`
- `packages/modules/notifications/src/queries/list-webhook-deliveries.ts`
- `packages/modules/notifications/src/commands/redeliver-webhook.ts`
- Tests: `lib/__tests__/webhook-endpoint.test.ts`, `__integration__/webhook-crud.test.ts`, `__integration__/webhook-deliveries.test.ts`.

**Modify:**
- `packages/modules/notifications/src/routes.ts` — mount the 7 webhook routes under the existing `/api/notifications` prefix.
- `packages/modules/notifications/src/index.ts` — register the new commands + queries.

---

## Task 1: Shared endpoint helpers

**Files:**
- Create: `packages/modules/notifications/src/lib/webhook-endpoint.ts`
- Test: `packages/modules/notifications/src/lib/__tests__/webhook-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/modules/notifications/src/lib/__tests__/webhook-endpoint.test.ts
import { describe, expect, test } from "bun:test";
import {
  generateWebhookSecret,
  isValidCategories,
  KNOWN_CATEGORIES,
  serializeWebhook,
} from "../webhook-endpoint";

describe("isValidCategories", () => {
  test("accepts a subset of known categories", () => {
    expect(isValidCategories(["system", "billing"])).toBe(true);
    expect(isValidCategories([...KNOWN_CATEGORIES])).toBe(true);
  });
  test("rejects empty, unknown, non-array, and non-string entries", () => {
    expect(isValidCategories([])).toBe(false);
    expect(isValidCategories(["nope"])).toBe(false);
    expect(isValidCategories("system" as unknown as string[])).toBe(false);
    expect(isValidCategories([1] as unknown as string[])).toBe(false);
  });
});

describe("generateWebhookSecret", () => {
  test("is prefixed and unique", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith("whsec_")).toBe(true);
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });
});

describe("serializeWebhook", () => {
  test("omits the secret and keeps the public fields", () => {
    const row = {
      id: "w1",
      tenantId: "t1",
      url: "https://x/y",
      secret: "whsec_super_secret",
      categories: ["system"],
      description: "d",
      status: "active",
      consecutiveFailures: "0",
      lastDeliveryAt: null,
      lastStatus: null,
      disabledReason: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const out = serializeWebhook(row);
    expect("secret" in out).toBe(false);
    expect(out).toMatchObject({ id: "w1", url: "https://x/y", status: "active" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-endpoint.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/modules/notifications/src/lib/webhook-endpoint.ts
import { nanoid } from "nanoid";
import type { notificationWebhook } from "@baseworks/db";

/** The categories an endpoint may subscribe to (mirrors catalog Category). */
export const KNOWN_CATEGORIES = ["system", "team", "billing", "files", "security"] as const;

/** True if `value` is a non-empty array of known category strings. */
export function isValidCategories(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((c) => typeof c === "string" && (KNOWN_CATEGORIES as readonly string[]).includes(c))
  );
}

/** Generate an opaque signing secret. Shown to the tenant once, then never again. */
export function generateWebhookSecret(): string {
  return `whsec_${nanoid(32)}`;
}

/** Public projection of an endpoint row — the `secret` is never returned from reads. */
export function serializeWebhook(row: typeof notificationWebhook.$inferSelect) {
  const { secret: _secret, ...rest } = row;
  return rest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/modules/notifications/src/lib/__tests__/webhook-endpoint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/modules/notifications/src/lib/webhook-endpoint.ts packages/modules/notifications/src/lib/__tests__/webhook-endpoint.test.ts
git commit -m "feat(notifications): webhook endpoint helpers (categories, secret, serialize)"
```

---

## Task 2: createWebhook command

**Files:**
- Create: `packages/modules/notifications/src/commands/create-webhook.ts`
- Test: covered by the integration suite in Task 9 (`__integration__/webhook-crud.test.ts`).

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/commands/create-webhook.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import {
  generateWebhookSecret,
  isValidCategories,
  serializeWebhook,
} from "../lib/webhook-endpoint";
import { assertSafeWebhookUrl } from "../lib/webhook-security";

const Input = Type.Object({
  url: Type.String({ minLength: 1 }),
  categories: Type.Array(Type.String()),
  description: Type.Optional(Type.String()),
});

/**
 * Register a webhook endpoint. Validates the URL through the SSRF guard,
 * generates a signing secret, and returns the created row WITH the secret —
 * the only time it is ever exposed.
 */
export const createWebhook = defineCommand(Input, async (input, ctx) => {
  if (!isValidCategories(input.categories)) {
    return err("INVALID_CATEGORIES");
  }
  try {
    await assertSafeWebhookUrl(input.url);
  } catch (e) {
    return err(e instanceof Error ? e.message : "INVALID_WEBHOOK_URL");
  }

  const secret = generateWebhookSecret();
  const [row] = await requireWithTenant(ctx)((tx) =>
    tx
      .insert(notificationWebhook)
      .values({
        tenantId: ctx.tenantId,
        url: input.url,
        secret,
        categories: input.categories,
        description: input.description ?? null,
        status: "active",
        // biome-ignore lint/suspicious/noExplicitAny: insert shape narrowed by schema
      } as any)
      .returning(),
  );
  // Return the secret exactly once, alongside the public projection.
  return ok({ ...serializeWebhook(row), secret });
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/commands/create-webhook.ts
git commit -m "feat(notifications): createWebhook command (SSRF-validated, secret once)"
```

---

## Task 3: listWebhooks query

**Files:**
- Create: `packages/modules/notifications/src/queries/list-webhooks.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/queries/list-webhooks.ts
import { notificationWebhook } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { desc, eq } from "drizzle-orm";
import { serializeWebhook } from "../lib/webhook-endpoint";

const Input = Type.Object({});

/** List the tenant's webhook endpoints (secret omitted), newest first. */
export const listWebhooks = defineQuery(Input, async (_input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.tenantId, ctx.tenantId))
      .orderBy(desc(notificationWebhook.createdAt)),
  )) as (typeof notificationWebhook.$inferSelect)[];
  return ok(rows.map(serializeWebhook));
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/queries/list-webhooks.ts
git commit -m "feat(notifications): listWebhooks query (secret omitted)"
```

---

## Task 4: updateWebhook command

**Files:**
- Create: `packages/modules/notifications/src/commands/update-webhook.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/commands/update-webhook.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { isValidCategories, serializeWebhook } from "../lib/webhook-endpoint";
import { assertSafeWebhookUrl } from "../lib/webhook-security";

const Input = Type.Object({
  id: Type.String(),
  url: Type.Optional(Type.String({ minLength: 1 })),
  categories: Type.Optional(Type.Array(Type.String())),
  description: Type.Optional(Type.String()),
  // Tenants may activate or disable; auto_disabled is system-only.
  status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("disabled")])),
});

/**
 * Edit an endpoint. Re-validates a changed URL through the SSRF guard.
 * Re-enabling (status → active) also clears any auto-disable lockout by
 * resetting consecutiveFailures.
 */
export const updateWebhook = defineCommand(Input, async (input, ctx) => {
  if (input.categories !== undefined && !isValidCategories(input.categories)) {
    return err("INVALID_CATEGORIES");
  }
  if (input.url !== undefined) {
    try {
      await assertSafeWebhookUrl(input.url);
    } catch (e) {
      return err(e instanceof Error ? e.message : "INVALID_WEBHOOK_URL");
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: partial column patch
  const patch: any = {};
  if (input.url !== undefined) patch.url = input.url;
  if (input.categories !== undefined) patch.categories = input.categories;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "active") {
      patch.consecutiveFailures = "0";
      patch.disabledReason = null;
    }
  }
  if (Object.keys(patch).length === 0) return err("NO_FIELDS_TO_UPDATE");

  const updated = (await requireWithTenant(ctx)((tx) =>
    tx
      .update(notificationWebhook)
      .set(patch)
      .where(
        and(eq(notificationWebhook.id, input.id), eq(notificationWebhook.tenantId, ctx.tenantId)),
      )
      .returning(),
  )) as (typeof notificationWebhook.$inferSelect)[];
  if (updated.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok(serializeWebhook(updated[0]));
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/commands/update-webhook.ts
git commit -m "feat(notifications): updateWebhook command (re-validate, re-enable resets failures)"
```

---

## Task 5: deleteWebhook command

**Files:**
- Create: `packages/modules/notifications/src/commands/delete-webhook.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/commands/delete-webhook.ts
import { notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";

const Input = Type.Object({ id: Type.String() });

/** Delete an endpoint and cascade its delivery audit rows. */
export const deleteWebhook = defineCommand(Input, async (input, ctx) => {
  const deleted = await requireWithTenant(ctx)(async (tx) => {
    const rows = (await tx
      .delete(notificationWebhook)
      .where(
        and(eq(notificationWebhook.id, input.id), eq(notificationWebhook.tenantId, ctx.tenantId)),
      )
      .returning()) as (typeof notificationWebhook.$inferSelect)[];
    if (rows.length > 0) {
      await tx
        .delete(notificationWebhookDelivery)
        .where(eq(notificationWebhookDelivery.webhookId, input.id));
    }
    return rows;
  });
  if (deleted.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok({ id: input.id });
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/commands/delete-webhook.ts
git commit -m "feat(notifications): deleteWebhook command (cascade deliveries)"
```

---

## Task 6: rotateWebhookSecret command

**Files:**
- Create: `packages/modules/notifications/src/commands/rotate-webhook-secret.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/commands/rotate-webhook-secret.ts
import { notificationWebhook } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { generateWebhookSecret } from "../lib/webhook-endpoint";

const Input = Type.Object({ id: Type.String() });

/** Issue a new signing secret for an endpoint and return it once. */
export const rotateWebhookSecret = defineCommand(Input, async (input, ctx) => {
  const secret = generateWebhookSecret();
  const updated = (await requireWithTenant(ctx)((tx) =>
    tx
      .update(notificationWebhook)
      .set({ secret })
      .where(
        and(eq(notificationWebhook.id, input.id), eq(notificationWebhook.tenantId, ctx.tenantId)),
      )
      .returning(),
  )) as (typeof notificationWebhook.$inferSelect)[];
  if (updated.length === 0) return err("WEBHOOK_NOT_FOUND");
  return ok({ id: input.id, secret });
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/commands/rotate-webhook-secret.ts
git commit -m "feat(notifications): rotateWebhookSecret command (new secret once)"
```

---

## Task 7: listWebhookDeliveries query

**Files:**
- Create: `packages/modules/notifications/src/queries/list-webhook-deliveries.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/queries/list-webhook-deliveries.ts
import { notificationWebhookDelivery } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, desc, eq } from "drizzle-orm";

const Input = Type.Object({
  webhookId: Type.String(),
  status: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

/** Paginated delivery history for one of the tenant's endpoints, newest first. */
export const listWebhookDeliveries = defineQuery(Input, async (input, ctx) => {
  const rows = (await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notificationWebhookDelivery)
      .where(
        and(
          eq(notificationWebhookDelivery.tenantId, ctx.tenantId),
          eq(notificationWebhookDelivery.webhookId, input.webhookId),
          input.status ? eq(notificationWebhookDelivery.status, input.status) : undefined,
        ),
      )
      .orderBy(desc(notificationWebhookDelivery.createdAt))
      .limit(input.limit ?? 20)
      .offset(input.offset ?? 0),
  )) as (typeof notificationWebhookDelivery.$inferSelect)[];
  return ok(rows);
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/queries/list-webhook-deliveries.ts
git commit -m "feat(notifications): listWebhookDeliveries query (paginated, filterable)"
```

---

## Task 8: redeliverWebhook command

**Files:**
- Create: `packages/modules/notifications/src/commands/redeliver-webhook.ts`

- [ ] **Step 1: Write the implementation**

```ts
// packages/modules/notifications/src/commands/redeliver-webhook.ts
import { notificationWebhookDelivery } from "@baseworks/db";
import { defineCommand, err, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";
import { getWebhookQueue } from "../lib/webhook-queue";

const Input = Type.Object({ deliveryId: Type.String() });

/**
 * Re-send a past delivery. Clones the source delivery's stored payload into a
 * NEW pending row (preserving the original audit row) and enqueues it.
 */
export const redeliverWebhook = defineCommand(Input, async (input, ctx) => {
  const queue = getWebhookQueue();
  if (!queue) return err("QUEUE_UNAVAILABLE");

  const newId = await requireWithTenant(ctx)(async (tx) => {
    const [src] = (await tx
      .select()
      .from(notificationWebhookDelivery)
      .where(
        and(
          eq(notificationWebhookDelivery.id, input.deliveryId),
          eq(notificationWebhookDelivery.tenantId, ctx.tenantId),
        ),
      )
      .limit(1)) as (typeof notificationWebhookDelivery.$inferSelect)[];
    if (!src) return null;

    const [clone] = (await tx
      .insert(notificationWebhookDelivery)
      .values({
        tenantId: ctx.tenantId,
        webhookId: src.webhookId,
        eventType: src.eventType,
        category: src.category,
        payload: src.payload,
        status: "pending",
        // biome-ignore lint/suspicious/noExplicitAny: insert shape narrowed by schema
      } as any)
      .returning()) as (typeof notificationWebhookDelivery.$inferSelect)[];
    return clone.id;
  });

  if (!newId) return err("DELIVERY_NOT_FOUND");
  await queue.add("webhook-event", { kind: "webhook-event", deliveryId: newId });
  return ok({ deliveryId: newId });
});
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/modules/notifications/src/commands/redeliver-webhook.ts
git commit -m "feat(notifications): redeliverWebhook command (clone payload + enqueue)"
```

---

## Task 9: Routes + registration + integration tests

**Files:**
- Modify: `packages/modules/notifications/src/routes.ts`
- Modify: `packages/modules/notifications/src/index.ts`
- Test: `packages/modules/notifications/src/__integration__/webhook-crud.test.ts`
- Test: `packages/modules/notifications/src/__integration__/webhook-deliveries.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```ts
// packages/modules/notifications/src/__integration__/webhook-crud.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notificationWebhook } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { createWebhook } from "../commands/create-webhook";
import { deleteWebhook } from "../commands/delete-webhook";
import { rotateWebhookSecret } from "../commands/rotate-webhook-secret";
import { updateWebhook } from "../commands/update-webhook";
import { listWebhooks } from "../queries/list-webhooks";
import { makeCtx } from "./_ctx";

const T = "wh-crud-it-tenant";
let ok = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    ok = true;
  } catch {
    ok = false;
  }
});
afterAll(async () => {
  if (ok) await getDb().delete(notificationWebhook).where(eq(notificationWebhook.tenantId, T));
});

describe("webhook CRUD", () => {
  test("create → list → update → rotate → delete round trip", async () => {
    if (!ok) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "u1");

    // create returns the secret exactly once
    const created = await createWebhook(
      { url: "https://example.com/hook", categories: ["system"], description: "d" },
      ctx,
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const id = created.data.id;
    expect(created.data.secret.startsWith("whsec_")).toBe(true);

    // list omits the secret
    const listed = await listWebhooks({}, ctx);
    expect(listed.success).toBe(true);
    if (!listed.success) return;
    expect(listed.data).toHaveLength(1);
    expect("secret" in listed.data[0]).toBe(false);

    // update categories
    const updated = await updateWebhook({ id, categories: ["system", "billing"] }, ctx);
    expect(updated.success).toBe(true);

    // rotate yields a different secret
    const rotated = await rotateWebhookSecret({ id }, ctx);
    expect(rotated.success).toBe(true);
    if (!rotated.success) return;
    expect(rotated.data.secret).not.toBe(created.data.secret);

    // delete
    const removed = await deleteWebhook({ id }, ctx);
    expect(removed.success).toBe(true);
    const after = await listWebhooks({}, ctx);
    expect(after.success && after.data).toHaveLength(0);
  }, 30_000);

  test("rejects invalid categories and non-https URLs", async () => {
    if (!ok) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "u1");
    const badCat = await createWebhook(
      { url: "https://example.com/hook", categories: ["nope"] },
      ctx,
    );
    expect(badCat.success).toBe(false);
    const badUrl = await createWebhook({ url: "http://example.com/hook", categories: ["system"] }, ctx);
    expect(badUrl.success).toBe(false);
    const privateUrl = await createWebhook(
      { url: "https://localhost/hook", categories: ["system"] },
      ctx,
    );
    expect(privateUrl.success).toBe(false);
  }, 30_000);

  test("re-enabling an auto_disabled endpoint resets consecutiveFailures", async () => {
    if (!ok) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "u1");
    const created = await createWebhook(
      { url: "https://example.com/hook", categories: ["system"] },
      ctx,
    );
    if (!created.success) throw new Error("setup failed");
    const id = created.data.id;
    // Simulate a system auto-disable.
    await getDb()
      .update(notificationWebhook)
      .set({ status: "auto_disabled", consecutiveFailures: "15", disabledReason: "x" })
      .where(eq(notificationWebhook.id, id));

    const reenabled = await updateWebhook({ id, status: "active" }, ctx);
    expect(reenabled.success).toBe(true);
    const [row] = await getDb()
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.id, id));
    expect(row.status).toBe("active");
    expect(row.consecutiveFailures).toBe("0");
  }, 30_000);
});
```

```ts
// packages/modules/notifications/src/__integration__/webhook-deliveries.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notificationWebhook, notificationWebhookDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { redeliverWebhook } from "../commands/redeliver-webhook";
import { listWebhookDeliveries } from "../queries/list-webhook-deliveries";
import { makeCtx } from "./_ctx";

const T = "wh-deliveries-it-tenant";
let ok = false;
let webhookId = "";
let deliveryId = "";

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    const [ep] = await getDb()
      .insert(notificationWebhook)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({ tenantId: T, url: "https://example.com/h", secret: "s", categories: ["system"], status: "active" } as any)
      .returning();
    webhookId = ep.id;
    const [del] = await getDb()
      .insert(notificationWebhookDelivery)
      // biome-ignore lint/suspicious/noExplicitAny: seed
      .values({ tenantId: T, webhookId: ep.id, eventType: "system.test", category: "system", payload: { event: "system.test" }, status: "failed" } as any)
      .returning();
    deliveryId = del.id;
    ok = true;
  } catch {
    ok = false;
  }
});
afterAll(async () => {
  if (!ok) return;
  await getDb().delete(notificationWebhookDelivery).where(eq(notificationWebhookDelivery.tenantId, T));
  await getDb().delete(notificationWebhook).where(eq(notificationWebhook.tenantId, T));
});

describe("webhook deliveries", () => {
  test("lists deliveries for an endpoint", async () => {
    if (!ok) return console.warn("SKIPPED");
    const res = await listWebhookDeliveries({ webhookId }, makeCtx(T, "u1"));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.length).toBeGreaterThanOrEqual(1);
    expect(res.data[0].webhookId).toBe(webhookId);
  }, 30_000);

  test("redeliver clones the payload into a new pending row", async () => {
    if (!ok) return console.warn("SKIPPED");
    const res = await redeliverWebhook({ deliveryId }, makeCtx(T, "u1"));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.deliveryId).not.toBe(deliveryId);
    const [clone] = await getDb()
      .select()
      .from(notificationWebhookDelivery)
      .where(eq(notificationWebhookDelivery.id, res.data.deliveryId));
    expect(clone.status).toBe("pending");
    expect(clone.webhookId).toBe(webhookId);
  }, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/modules/notifications/src/__integration__/webhook-crud.test.ts packages/modules/notifications/src/__integration__/webhook-deliveries.test.ts`
Expected: FAIL (commands not yet imported into routes/registry is irrelevant — the commands exist from Tasks 2-8, so these should actually pass once imports resolve; if Tasks 2-8 are done, run them now and they should PASS. If running this task standalone, the imports resolve to the created files). If `DATABASE_URL_RLS` is unset → SKIPPED (acceptable).

- [ ] **Step 3: Mount the routes**

In `packages/modules/notifications/src/routes.ts`, add imports at the top:

```ts
import { createWebhook } from "./commands/create-webhook";
import { deleteWebhook } from "./commands/delete-webhook";
import { redeliverWebhook } from "./commands/redeliver-webhook";
import { rotateWebhookSecret } from "./commands/rotate-webhook-secret";
import { updateWebhook } from "./commands/update-webhook";
import { listWebhookDeliveries } from "./queries/list-webhook-deliveries";
import { listWebhooks } from "./queries/list-webhooks";
```

Then chain these routes onto the existing `notificationRoutes` Elysia instance (before the final `;`), using the same `handlerCtx` + `any`-typed context pattern as the existing routes:

```ts
  .post("/webhooks", async ({ handlerCtx, body }: any) => createWebhook(body, handlerCtx))
  .get("/webhooks", async ({ handlerCtx }: any) => listWebhooks({}, handlerCtx))
  .patch("/webhooks/:id", async ({ handlerCtx, params, body }: any) =>
    updateWebhook({ id: params.id, ...body }, handlerCtx),
  )
  .delete("/webhooks/:id", async ({ handlerCtx, params }: any) =>
    deleteWebhook({ id: params.id }, handlerCtx),
  )
  .post("/webhooks/:id/rotate-secret", async ({ handlerCtx, params }: any) =>
    rotateWebhookSecret({ id: params.id }, handlerCtx),
  )
  .get("/webhooks/:id/deliveries", async ({ handlerCtx, params, query }: any) =>
    listWebhookDeliveries(
      {
        webhookId: params.id,
        status: query.status,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      },
      handlerCtx,
    ),
  )
  .post("/webhooks/deliveries/:deliveryId/redeliver", async ({ handlerCtx, params }: any) =>
    redeliverWebhook({ deliveryId: params.deliveryId }, handlerCtx),
  )
```

- [ ] **Step 4: Register commands + queries in the module**

In `packages/modules/notifications/src/index.ts`, add imports:

```ts
import { createWebhook } from "./commands/create-webhook";
import { deleteWebhook } from "./commands/delete-webhook";
import { redeliverWebhook } from "./commands/redeliver-webhook";
import { rotateWebhookSecret } from "./commands/rotate-webhook-secret";
import { updateWebhook } from "./commands/update-webhook";
import { listWebhookDeliveries } from "./queries/list-webhook-deliveries";
import { listWebhooks } from "./queries/list-webhooks";
```

Add to the `commands` map:

```ts
    "notifications:create-webhook": createWebhook,
    "notifications:update-webhook": updateWebhook,
    "notifications:delete-webhook": deleteWebhook,
    "notifications:rotate-webhook-secret": rotateWebhookSecret,
    "notifications:redeliver-webhook": redeliverWebhook,
```

Add to the `queries` map:

```ts
    "notifications:list-webhooks": listWebhooks,
    "notifications:list-webhook-deliveries": listWebhookDeliveries,
```

- [ ] **Step 5: Typecheck + run the suite**

Run: `bun run typecheck`
Expected: PASS.
Run: `bun test packages/modules/notifications`
Expected: PASS (new unit + integration suites; integration SKIP without `DATABASE_URL_RLS`).

- [ ] **Step 6: Biome + cross-module lint**

Run: `bunx biome check packages/modules/notifications/src`
Expected: clean (only pre-existing `any` warnings).
Run: `bun run lint:cross-module`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/modules/notifications/src/routes.ts packages/modules/notifications/src/index.ts packages/modules/notifications/src/__integration__/webhook-crud.test.ts packages/modules/notifications/src/__integration__/webhook-deliveries.test.ts
git commit -m "feat(notifications): mount webhook CRUD routes + register commands/queries"
```

---

## Self-Review Notes (for the implementer)

- **Auth scope is tenant-wide, not admin-gated.** Any tenant member can manage webhooks (RLS isolates tenants, but not roles). Webhook config is sensitive (it can exfiltrate notification content) — admin-only gating is a recommended fast-follow once RBAC is wired in; out of scope for 4b per the spec.
- **`expect().rejects` + live DB hangs in this repo** (see the project memory). All command tests assert `result.success`, never `.rejects` — keep it that way; commands return `err()` for business failures rather than throwing.
- **Secret is write-once:** only `createWebhook` and `rotateWebhookSecret` return it; `serializeWebhook` strips it from every read. Do not add it to list/update responses.
- **URL validation does real DNS** (`assertSafeWebhookUrl` with no injected lookup). Tests use `example.com` (public, passes) and `localhost`/`http://` (rejected without external network). CI runners have DNS.
- **Redeliver preserves history:** it clones into a new row, never mutates the source delivery.
- **Deferred:** 4c (web UI), 4d (admin UI).
