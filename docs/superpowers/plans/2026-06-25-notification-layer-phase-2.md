# Notification Layer — Phase 2 Implementation Plan (notify() + in-app + SSE, backend)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox (`- [ ]`) steps. (Executed via the gated multi-agent Workflow.)

**Goal:** The first behavioral slice — `notify()` creates RLS-scoped notifications and delivers them **in-app**, with an **SSE** endpoint that pushes "new notification" over a Redis pub/sub fan-out. Plus the read-model queries (`list`, `unread-count`) and `mark-read`/`mark-all-read`, all behind the auth+tenant route stack. **Web UI (bell/feed/EventSource hook) is Phase 2-web, a separate PR.**

**Architecture:** Builds on Phase 1 (schema, `ChannelAdapter` port, catalog). `notify()` (CQRS command) resolves recipients, renders from the catalog, writes the `notification` row through `ctx.withTenant` (RLS), then runs registered channel adapters — Phase 2 registers only the **in-app** adapter (write delivery row + Redis `publish`). SSE: an Elysia streaming route subscribes (via a shared dedicated ioredis subscriber + a refcounted channel registry) to `notif:{tenantId}:{userId}`. Email/webhook adapters + preferences come in later phases — `notify()` already iterates an adapter registry so they drop in.

**Tech Stack:** Bun, Elysia (streaming `Response`), Drizzle (RLS via `ctx.withTenant`), ioredis pub/sub (`@baseworks/queue`), TypeBox, `ctx.dispatch` (cross-module recipient resolution), Bun test.

**Spec:** `docs/superpowers/specs/2026-06-25-notification-layer-design.md` · **Builds on:** Phase 1 (#10)

---

## File structure (Phase 2)

| File | Responsibility |
|------|----------------|
| `packages/modules/notifications/src/lib/recipients.ts` (create) | resolve `{userIds?, role?}` → user-id list (role via `ctx.dispatch("auth:list-members")`) |
| `packages/modules/notifications/src/channels/registry.ts` (create) | in-process adapter registry keyed by `Channel` |
| `packages/modules/notifications/src/channels/in-app.ts` (create) | in-app adapter: delivery row + Redis publish |
| `packages/modules/notifications/src/sse/bridge.ts` (create) | shared ioredis subscriber + refcounted per-channel emitter registry |
| `packages/modules/notifications/src/commands/notify.ts` (create) | the engine |
| `packages/modules/notifications/src/commands/mark-read.ts` · `mark-all-read.ts` (create) | read-state mutations |
| `packages/modules/notifications/src/queries/list-notifications.ts` · `unread-count.ts` (create) | read model (RLS + recipient predicate) |
| `packages/modules/notifications/src/routes.ts` (create) | HTTP: list, unread-count, read, read-all, **stream** (SSE) |
| `packages/modules/notifications/src/index.ts` (modify) | add commands/queries/routes to the `ModuleDefinition` |
| tests alongside each + `apps/api/src/__tests__/notifications-flow.test.ts` (full HTTP) | |

> Every DB read/write of `notification*` tables goes through `ctx.withTenant` (RLS) **and** filters `recipient_user_id = ctx.userId` where user-scoped (RLS is tenant-level; per-recipient is an app predicate).

---

## Task 1: Recipient resolution

**Files:** Create `packages/modules/notifications/src/lib/recipients.ts` · Test `…/lib/__tests__/recipients.test.ts`

- [ ] **Step 1: Failing test** — role resolution dispatches `auth:list-members` and filters; explicit ids pass through; result deduped.

```ts
// packages/modules/notifications/src/lib/__tests__/recipients.test.ts
import { describe, expect, test } from "bun:test";
import { resolveRecipients } from "../recipients";

function ctxWith(members: Array<{ userId: string; role: string }>) {
  return {
    tenantId: "t1",
    dispatch: async (cmd: string) =>
      cmd === "auth:list-members"
        ? { success: true, data: members }
        : { success: false, error: "unexpected" },
  } as any;
}

describe("resolveRecipients", () => {
  test("explicit userIds pass through, deduped", async () => {
    const ids = await resolveRecipients({ userIds: ["a", "a", "b"] }, ctxWith([]));
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
  test("role selects matching members", async () => {
    const ids = await resolveRecipients(
      { role: "owner" },
      ctxWith([{ userId: "a", role: "owner" }, { userId: "b", role: "member" }]),
    );
    expect([...ids]).toEqual(["a"]);
  });
  test("userIds + role union", async () => {
    const ids = await resolveRecipients(
      { userIds: ["x"], role: "owner" },
      ctxWith([{ userId: "a", role: "owner" }]),
    );
    expect([...ids].sort()).toEqual(["a", "x"]);
  });
});
```

- [ ] **Step 2: Run → fails** (`../recipients` not found). `bun test packages/modules/notifications/src/lib/__tests__/recipients.test.ts`

- [ ] **Step 3: Implement**

```ts
// packages/modules/notifications/src/lib/recipients.ts
import type { HandlerContext } from "@baseworks/shared";

export interface RecipientSelector {
  userIds?: string[];
  role?: string; // "owner" | "admin" | "member" | a custom org role
}

/**
 * Resolve a selector to a deduped set of recipient user ids. `role` is resolved
 * against the active tenant's membership via the auth module's list-members
 * query (no cross-module import — dispatched through the bus).
 */
export async function resolveRecipients(
  sel: RecipientSelector,
  ctx: HandlerContext,
): Promise<Set<string>> {
  const ids = new Set<string>(sel.userIds ?? []);
  if (sel.role && ctx.dispatch) {
    const res = await ctx.dispatch("auth:list-members", { organizationId: ctx.tenantId });
    if (res.success) {
      for (const m of res.data as Array<{ userId: string; role: string }>) {
        if (m.role === sel.role) ids.add(m.userId);
      }
    }
  }
  return ids;
}
```

> Implementer: confirm `auth:list-members`'s input key (`organizationId` vs `tenantId`) and output member shape against `packages/modules/auth/src/queries/list-members.ts`; adjust the field names here to match.

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(notifications): recipient resolution`.

## Task 2: Channel registry + in-app adapter

**Files:** Create `channels/registry.ts`, `channels/in-app.ts` · Test `channels/__tests__/in-app.test.ts`

- [ ] **Step 1: Failing test** — in-app adapter publishes to `notif:{tenantId}:{userId}` and returns `sent`.

```ts
// packages/modules/notifications/src/channels/__tests__/in-app.test.ts
import { describe, expect, test } from "bun:test";
import { InAppAdapter } from "../in-app";

describe("InAppAdapter", () => {
  test("publishes to the per-user channel and reports sent", async () => {
    const published: Array<[string, string]> = [];
    const adapter = new InAppAdapter({ publish: (ch, msg) => published.push([ch, msg]) });
    const res = await adapter.deliver(
      { id: "n1", tenantId: "t1", recipientUserId: "u1", type: "system.test", category: "system", severity: "info", title: "t", body: "b" },
      "d1",
    );
    expect(res.status).toBe("sent");
    expect(published[0][0]).toBe("notif:t1:u1");
    expect(JSON.parse(published[0][1])).toMatchObject({ type: "notification.created", id: "n1" });
  });
});
```

- [ ] **Step 2: Run → fails.** `bun test packages/modules/notifications/src/channels/__tests__/in-app.test.ts`

- [ ] **Step 3: Implement registry + adapter**

```ts
// packages/modules/notifications/src/channels/registry.ts
import type { Channel, ChannelAdapter } from "./channel";

const adapters = new Map<Channel, ChannelAdapter>();
export function registerAdapter(a: ChannelAdapter): void {
  adapters.set(a.name, a);
}
export function getAdapter(channel: Channel): ChannelAdapter | undefined {
  return adapters.get(channel);
}
export function registeredChannels(): Channel[] {
  return [...adapters.keys()];
}
```

```ts
// packages/modules/notifications/src/channels/in-app.ts
import type { Channel, ChannelAdapter, DeliverableNotification, DeliveryResult } from "./channel";

export interface Publisher {
  publish(channel: string, message: string): unknown;
}

/** Channel key for a user's per-tenant SSE stream. */
export function userChannel(tenantId: string, userId: string): string {
  return `notif:${tenantId}:${userId}`;
}

/**
 * In-app delivery: the `notification` row is already written by notify(); this
 * publishes a lightweight "new notification" signal to the recipient's Redis
 * channel (fanned out to any SSE stream on any instance). Pure publish — the
 * delivery-row status is managed by the caller.
 */
export class InAppAdapter implements ChannelAdapter {
  readonly name: Channel = "in-app";
  constructor(private readonly redis: Publisher) {}
  async deliver(n: DeliverableNotification, _deliveryId: string): Promise<DeliveryResult> {
    this.redis.publish(
      userChannel(n.tenantId, n.recipientUserId),
      JSON.stringify({ type: "notification.created", id: n.id }),
    );
    return { status: "sent" };
  }
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(notifications): channel registry + in-app adapter`.

## Task 3: SSE Redis bridge

**Files:** Create `sse/bridge.ts` · Test `sse/__tests__/bridge.test.ts`

- [ ] **Step 1: Failing test** — a message published on a channel reaches a subscribed emitter; refcount unsubscribe stops it.

```ts
// packages/modules/notifications/src/sse/__tests__/bridge.test.ts
import { describe, expect, test } from "bun:test";
import { SseBridge } from "../bridge";

// Fake ioredis subscriber: records subscribe/unsubscribe, lets the test emit messages.
function fakeSub() {
  const handlers: Array<(ch: string, msg: string) => void> = [];
  const subscribed = new Set<string>();
  return {
    sub: {
      subscribe: async (ch: string) => { subscribed.add(ch); },
      unsubscribe: async (ch: string) => { subscribed.delete(ch); },
      on: (_e: string, h: (ch: string, msg: string) => void) => handlers.push(h),
    },
    emit: (ch: string, msg: string) => { if (subscribed.has(ch)) handlers.forEach((h) => h(ch, msg)); },
    subscribed,
  };
}

describe("SseBridge", () => {
  test("routes published messages to the channel's emitters; refcounted", async () => {
    const f = fakeSub();
    const bridge = new SseBridge(f.sub as any);
    const got: string[] = [];
    const unsub = await bridge.subscribe("notif:t:u", (m) => got.push(m));
    expect(f.subscribed.has("notif:t:u")).toBe(true);
    f.emit("notif:t:u", "hello");
    expect(got).toEqual(["hello"]);
    await unsub();
    expect(f.subscribed.has("notif:t:u")).toBe(false); // last subscriber gone
  });
});
```

- [ ] **Step 2: Run → fails.** `bun test packages/modules/notifications/src/sse/__tests__/bridge.test.ts`

- [ ] **Step 3: Implement**

```ts
// packages/modules/notifications/src/sse/bridge.ts
/** Minimal subset of ioredis used by the bridge (a DEDICATED subscriber connection). */
export interface Subscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", handler: (channel: string, message: string) => void): unknown;
}

type Emit = (message: string) => void;

/**
 * One shared ioredis subscriber per process, multiplexed across users via a
 * refcounted per-channel emitter set. The SSE route registers an emitter for
 * `notif:{tenantId}:{userId}`; the in-app adapter's publish (any instance)
 * arrives here and is fanned out to that user's open streams. Pass a DEDICATED
 * connection (ioredis enters subscriber mode): `getRedisConnection(url).duplicate()`.
 */
export class SseBridge {
  private readonly channels = new Map<string, Set<Emit>>();
  private wired = false;
  constructor(private readonly sub: Subscriber) {}

  private wire() {
    if (this.wired) return;
    this.sub.on("message", (channel, message) => {
      for (const emit of this.channels.get(channel) ?? []) emit(message);
    });
    this.wired = true;
  }

  /** Register an emitter for a channel; returns an unsubscribe fn. */
  async subscribe(channel: string, emit: Emit): Promise<() => Promise<void>> {
    this.wire();
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(emit);
    return async () => {
      const s = this.channels.get(channel);
      if (!s) return;
      s.delete(emit);
      if (s.size === 0) {
        this.channels.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    };
  }
}
```

- [ ] **Step 4: Run → pass.** **Step 5: Commit** `feat(notifications): SSE Redis pub/sub bridge`.

## Task 4: `notify()` engine

**Files:** Create `commands/notify.ts` · Test `__integration__/notify.test.ts` (live DB + RLS)

- [ ] **Step 1: Implement** (then drive with the integration test in Step 2)

```ts
// packages/modules/notifications/src/commands/notify.ts
import { notification, notificationDelivery } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { getCatalogEntry } from "../catalog";
import { getAdapter, registeredChannels } from "../channels/registry";
import { resolveRecipients } from "../lib/recipients";

const NotifyInput = Type.Object({
  type: Type.String({ minLength: 1 }),
  recipients: Type.Object({
    userIds: Type.Optional(Type.Array(Type.String())),
    role: Type.Optional(Type.String()),
  }),
  data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  overrides: Type.Optional(
    Type.Object({
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
    }),
  ),
});

export const notify = defineCommand(NotifyInput, async (input, ctx) => {
  const entry = getCatalogEntry(input.type);
  const recipients = await resolveRecipients(input.recipients, ctx);
  const rendered = entry.render(input.data ?? {});
  const title = input.overrides?.title ?? rendered.title;
  const body = input.overrides?.body ?? rendered.body;
  const url = input.overrides?.url ?? rendered.url ?? null;
  const actions = rendered.actions ?? null;

  // Channels we will actually deliver this phase = catalog defaults ∩ registered adapters.
  const channels = entry.defaultChannels.filter((c) => registeredChannels().includes(c));

  const createdIds: string[] = [];
  for (const recipientUserId of recipients) {
    await requireWithTenant(ctx)(async (tx) => {
      const [row] = await tx
        .insert(notification)
        .values({
          tenantId: ctx.tenantId,
          recipientUserId,
          type: input.type,
          category: entry.category,
          severity: entry.severity,
          title,
          body,
          url,
          data: input.data ?? null,
          actions,
        } as any)
        .returning();
      createdIds.push(row.id);

      for (const channel of channels) {
        const [delivery] = await tx
          .insert(notificationDelivery)
          .values({ tenantId: ctx.tenantId, notificationId: row.id, channel, status: "pending" } as any)
          .returning();
        const adapter = getAdapter(channel);
        const result = adapter
          ? await adapter.deliver(
              { id: row.id, tenantId: ctx.tenantId, recipientUserId, type: input.type, category: entry.category, severity: entry.severity, title, body, url, data: input.data ?? null, actions },
              delivery.id,
            )
          : ({ status: "skipped", reason: "no adapter" } as const);
        await tx
          .update(notificationDelivery)
          .set({ status: result.status, error: result.status === "failed" ? result.error : null })
          .where((await import("drizzle-orm")).eq(notificationDelivery.id, delivery.id));
      }
    });
  }

  ctx.emit("notification.created", { tenantId: ctx.tenantId, count: createdIds.length });
  return ok({ created: createdIds.length, ids: createdIds });
});
```

> The in-app adapter is registered at module load (Task 7) with a real publisher; the integration test registers a fake publisher so it asserts the publish without Redis.

- [ ] **Step 2: Integration test** (mirrors the example `rls-scoped` harness; skips without a distinct RLS URL)

```ts
// packages/modules/notifications/src/__integration__/notify.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notification, notificationDelivery } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { registerAdapter } from "../channels/registry";
import { InAppAdapter } from "../channels/in-app";
import { notify } from "../commands/notify";
import { makeCtx } from "./_ctx"; // see below

const T = "notif-it-tenant";
let ok = false;
const published: Array<[string, string]> = [];

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    registerAdapter(new InAppAdapter({ publish: (c, m) => published.push([c, m]) }));
    ok = true;
  } catch { ok = false; }
});
afterAll(async () => { if (ok) await getDb().delete(notification).where(eq(notification.tenantId, T)); });

describe("notify() in-app", () => {
  test("creates a notification + in-app delivery and publishes", async () => {
    if (!ok) return console.warn("SKIPPED");
    const res = await notify({ type: "system.test", recipients: { userIds: ["u1"] }, data: { message: "hi" } }, makeCtx(T, "u1"));
    expect(res.success).toBe(true);
    const rows = await getDb().select().from(notification).where(eq(notification.tenantId, T));
    expect(rows.length).toBe(1);
    expect(rows[0].body).toContain("hi");
    const deliveries = await getDb().select().from(notificationDelivery).where(eq(notificationDelivery.notificationId, rows[0].id));
    expect(deliveries.find((d) => d.channel === "in-app")?.status).toBe("sent");
    expect(published.some(([ch]) => ch === `notif:${T}:u1`)).toBe(true);
  }, 30_000);
});
```

```ts
// packages/modules/notifications/src/__integration__/_ctx.ts
import { getRlsDb, withTenant } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";

/** Minimal RLS-scoped HandlerContext for live notify() tests. */
export function makeCtx(tenantId: string, userId: string): HandlerContext {
  return {
    tenantId,
    userId,
    db: null as any,
    emit: () => {},
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
    dispatch: async () => ({ success: true, data: [] }),
  };
}
```

- [ ] **Step 3: Run** `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev DATABASE_URL_RLS=postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks bun test packages/modules/notifications/src/__integration__/notify.test.ts` → pass.
- [ ] **Step 4: Commit** `feat(notifications): notify() engine (in-app delivery)`.

## Task 5: Read model — list / unread-count / mark-read / mark-all-read

**Files:** Create `queries/list-notifications.ts`, `queries/unread-count.ts`, `commands/mark-read.ts`, `commands/mark-all-read.ts` · Test `__integration__/read-model.test.ts`

- [ ] **Step 1: Implement** (every query/command is RLS-scoped via `ctx.withTenant` **and** `recipient_user_id = ctx.userId`)

```ts
// packages/modules/notifications/src/queries/list-notifications.ts
import { notification } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, isNull } from "drizzle-orm";

const Input = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  unreadOnly: Type.Optional(Type.Boolean()),
});

export const listNotifications = defineQuery(Input, async (input, ctx) => {
  const rows = await requireWithTenant(ctx)((tx) =>
    tx
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.recipientUserId, ctx.userId as string),
          input.unreadOnly ? isNull(notification.readAt) : undefined,
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(input.limit ?? 20)
      .offset(input.offset ?? 0),
  );
  return ok(rows);
});
```

```ts
// packages/modules/notifications/src/queries/unread-count.ts
import { notification } from "@baseworks/db";
import { defineQuery, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, count, eq, isNull } from "drizzle-orm";

export const unreadCount = defineQuery(Type.Object({}), async (_input, ctx) => {
  const [r] = await requireWithTenant(ctx)((tx) =>
    tx
      .select({ count: count() })
      .from(notification)
      .where(and(eq(notification.recipientUserId, ctx.userId as string), isNull(notification.readAt))),
  );
  return ok({ unread: r?.count ?? 0 });
});
```

```ts
// packages/modules/notifications/src/commands/mark-read.ts
import { notification } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq } from "drizzle-orm";

export const markRead = defineCommand(Type.Object({ id: Type.String() }), async (input, ctx) => {
  await requireWithTenant(ctx)((tx) =>
    tx
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.id, input.id), eq(notification.recipientUserId, ctx.userId as string))),
  );
  return ok({ id: input.id });
});
```

```ts
// packages/modules/notifications/src/commands/mark-all-read.ts
import { notification } from "@baseworks/db";
import { defineCommand, ok, requireWithTenant } from "@baseworks/shared";
import { Type } from "@sinclair/typebox";
import { and, eq, isNull } from "drizzle-orm";

export const markAllRead = defineCommand(Type.Object({}), async (_input, ctx) => {
  await requireWithTenant(ctx)((tx) =>
    tx
      .update(notification)
      .set({ readAt: new Date() })
      .where(and(eq(notification.recipientUserId, ctx.userId as string), isNull(notification.readAt))),
  );
  return ok({});
});
```

- [ ] **Step 2: Integration test** — two recipients in one tenant: each lists only their own; unread-count + mark-read transition; mirror the `notify.test.ts` harness (`makeCtx(T, userId)`), seed via `notify()` to each user, assert per-recipient isolation (user A's list excludes user B's rows even though same tenant).
- [ ] **Step 3: Run** (RLS env) → pass. **Step 4: Commit** `feat(notifications): read model (list/unread/mark-read)`.

## Task 6: Routes (incl. SSE) + module wiring

**Files:** Create `routes.ts` · Modify `index.ts` · Test `apps/api/src/__tests__/notifications-flow.test.ts`

- [ ] **Step 1: Implement routes** (mirrors the files module's route plugin; `ctx.handlerCtx` is injected by the apps/api scoped derive)

```ts
// packages/modules/notifications/src/routes.ts
import { Elysia, t } from "elysia";
import { listNotifications } from "./queries/list-notifications";
import { unreadCount } from "./queries/unread-count";
import { markRead } from "./commands/mark-read";
import { markAllRead } from "./commands/mark-all-read";
import { userChannel } from "./channels/in-app";
import { getSseBridge } from "./sse/runtime"; // returns the process SseBridge (Task 7)

export const notificationRoutes = new Elysia({ prefix: "/api/notifications" })
  .get("/", async ({ handlerCtx, query }: any) =>
    listNotifications(
      { limit: query.limit ? Number(query.limit) : undefined, offset: query.offset ? Number(query.offset) : undefined, unreadOnly: query.unreadOnly === "true" },
      handlerCtx,
    ),
  )
  .get("/unread-count", async ({ handlerCtx }: any) => unreadCount({}, handlerCtx))
  .post("/:id/read", async ({ handlerCtx, params }: any) => markRead({ id: params.id }, handlerCtx))
  .post("/read-all", async ({ handlerCtx }: any) => markAllRead({}, handlerCtx))
  .get("/stream", ({ handlerCtx }: any) => {
    const channel = userChannel(handlerCtx.tenantId, handlerCtx.userId);
    const bridge = getSseBridge();
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(": connected\n\n"));
        const unsub = await bridge.subscribe(channel, (msg) =>
          controller.enqueue(enc.encode(`data: ${msg}\n\n`)),
        );
        const ka = setInterval(() => controller.enqueue(enc.encode(": ka\n\n")), 25_000);
        (controller as any)._cleanup = async () => { clearInterval(ka); await unsub(); };
      },
      async cancel() { await (this as any)._cleanup?.(); },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  });
```

> The `cancel`/`_cleanup` wiring is the load-bearing bit — verify the unsubscribe runs on client disconnect (Step 4 asserts the bridge refcount returns to 0 after the stream closes).

- [ ] **Step 2: Wire the `ModuleDefinition`** — modify `index.ts` to add `routes`, `commands`, `queries`:

```ts
import { notificationRoutes } from "./routes";
import { notify } from "./commands/notify";
import { markRead } from "./commands/mark-read";
import { markAllRead } from "./commands/mark-all-read";
import { listNotifications } from "./queries/list-notifications";
import { unreadCount } from "./queries/unread-count";

export default {
  name: "notifications",
  routes: notificationRoutes,
  commands: {
    "notifications:notify": notify,
    "notifications:mark-read": markRead,
    "notifications:mark-all-read": markAllRead,
  },
  queries: {
    "notifications:list": listNotifications,
    "notifications:unread-count": unreadCount,
  },
  events: ["notification.created"],
} satisfies ModuleDefinition;
```

- [ ] **Step 3: Full HTTP flow test** — `apps/api/src/__tests__/notifications-flow.test.ts`: build the app like `integration.test.ts` (auth + tenantMiddleware + the handlerCtx derive that supplies `withTenant: withTenant(getRlsDb(), tenantId, fn)`), mount `notificationRoutes`, register the in-app adapter with a fake publisher; sign up a user; `dispatch notifications:notify` (or POST a test route) to that user; `GET /api/notifications` → 1 row; `GET /unread-count` → 1; `POST /:id/read` → unread 0. (SSE stream covered by Task 3's unit test; an optional smoke connects the stream and asserts the bridge refcount.)
- [ ] **Step 4: Run** (RLS env) → pass. **Step 5: Commit** `feat(notifications): routes + SSE endpoint + module wiring`.

## Task 7: Runtime wiring (adapter + bridge + route mount) and full gate

**Files:** Create `sse/runtime.ts` · Modify `index.ts` (side-effect registration) · Verify route mount

- [ ] **Step 1: Runtime singletons** — a module that, on first use, registers the in-app adapter with a real publisher and builds the `SseBridge` from a dedicated subscriber:

```ts
// packages/modules/notifications/src/sse/runtime.ts
import { env } from "@baseworks/config";
import { getRedisConnection } from "@baseworks/queue";
import { InAppAdapter } from "../channels/in-app";
import { registerAdapter } from "../channels/registry";
import { SseBridge } from "./bridge";

let bridge: SseBridge | undefined;
let wired = false;

/** Idempotent: register the in-app adapter (publish via shared connection) + build the bridge (dedicated subscriber). */
export function ensureNotificationsRuntime(): void {
  if (wired || !env.REDIS_URL) return;
  const pub = getRedisConnection(env.REDIS_URL);
  registerAdapter(new InAppAdapter({ publish: (c, m) => pub.publish(c, m) }));
  bridge = new SseBridge(getRedisConnection(env.REDIS_URL).duplicate());
  wired = true;
}

export function getSseBridge(): SseBridge {
  ensureNotificationsRuntime();
  if (!bridge) throw new Error("notifications runtime requires REDIS_URL");
  return bridge;
}
```

Call `ensureNotificationsRuntime()` from the module's `index.ts` top-level (so api+worker boot wires it). Routes auto-mount through `registry.getModuleRoutes()` (no apps/api edit needed — `ModuleDefinition.routes` is collected there).

- [ ] **Step 2: Confirm mount** — start the API (`STRIPE_WEBHOOK_SECRET=dummy DATABASE_URL_RLS=… bun apps/api/src/index.ts`), `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/notifications` → **401** (gated, route exists; not 404). Stop the server.
- [ ] **Step 3: Full gate** — `bun run typecheck && bun run lint` (exit 0) and the module + flow suites:
  `BASEWORKS_RLS_PASSWORD=baseworks_rls_dev DATABASE_URL_RLS=postgres://baseworks_rls:baseworks_rls_dev@localhost:5432/baseworks bun test packages/modules/notifications apps/api/src/__tests__/notifications-flow.test.ts` → all pass.
- [ ] **Step 4: Commit** `feat(notifications): runtime wiring (adapter + SSE bridge)`.

---

## Self-review

- **Spec coverage (Phase 2 backend):** notify engine + recipient resolution (T1,T4) ✓; in-app channel + Redis publish (T2) ✓; SSE bridge + endpoint (T3,T6) ✓; read model list/unread/mark-read (T5) ✓; RLS + per-recipient isolation throughout ✓; routes mounted + 401-gated (T6,T7) ✓. **Out of scope (later phases):** email/webhook adapters + the `notifications-deliver` worker, dispatch actions, preferences, **web UI (Phase 2-web)**.
- **Placeholders:** none — concrete code per step.
- **Type consistency:** `Channel`/`ChannelAdapter`/`DeliverableNotification`/`DeliveryResult` (Phase 1) used in T2/T4; `getCatalogEntry`/`registeredChannels`/`getAdapter` consistent; `requireWithTenant`/`getRlsDb`/`withTenant` from `@baseworks/shared`+`@baseworks/db`; `userChannel()` shared by adapter (T2) + route (T6).
- **Verifications (not placeholders):** the exact `auth:list-members` input/output shape (T1 note); Elysia's `ReadableStream`/`Response` SSE behavior + that `cancel` fires on disconnect (T6 note) — the highest-risk item, gated by the bridge refcount assertion and the live 401 mount check.

## Note

**Phase 2-web** (the bell, dropdown feed, preferences-less mark-read, and the `EventSource` hook wired to React Query in `apps/web`) is the immediate follow-up PR, plus a browser pass to confirm SSE push end-to-end. Phases 3–6 (email+migration, webhooks, actions, preferences) follow.
