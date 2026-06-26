import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, getRlsDb, notification, scopedDb, withTenant } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";
import { eq, sql } from "drizzle-orm";
import { Elysia } from "elysia";
import {
  InAppAdapter,
  userChannel,
} from "../../../../packages/modules/notifications/src/channels/in-app";
import { registerAdapter } from "../../../../packages/modules/notifications/src/channels/registry";
import { notify } from "../../../../packages/modules/notifications/src/commands/notify";
import { notificationRoutes } from "../../../../packages/modules/notifications/src/routes";
import { getSseBridge } from "../../../../packages/modules/notifications/src/sse/runtime";
import { errorMiddleware } from "../core/middleware/error";
import { tenantMiddleware } from "../core/middleware/tenant";

/**
 * Full HTTP flow for the notifications module: auth + tenant middleware +
 * the handlerCtx derive (RLS via withTenant(getRlsDb(), tenantId, fn)), with
 * notificationRoutes mounted in the scoped band — exactly the apps/api stack.
 *
 * The in-app adapter is registered with a fake publisher so the read-model
 * assertions (list / unread-count / mark-read) need only Postgres + RLS. The
 * SSE smoke then exercises the real bridge (Redis) and asserts the refcount
 * returns to empty when the stream is cancelled (client disconnect).
 *
 * Requires PostgreSQL (RLS role) and — for the SSE smoke only — Redis.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL ?? "postgres://baseworks:baseworks@localhost:5432/baseworks";

let db: ReturnType<typeof createDb>;
let app: any;
let canConnect = false;

let cookies = "";
let tenantId = "";
let userId = "";

/** Captured publishes from the in-app adapter's fake publisher. */
const published: Array<[string, string]> = [];

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return pred();
}

/** Build an RLS-scoped HandlerContext for direct notify() seeding. */
function seedCtx(): HandlerContext {
  return {
    tenantId,
    userId,
    db: null as any,
    emit: () => {},
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
    dispatch: async () => ({ success: true, data: [] }),
  } as HandlerContext;
}

async function signUpUser(
  testApp: any,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  const response = await testApp.handle(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    }),
  );
  const setCookies = response.headers.getSetCookie?.() ?? [];
  return setCookies.map((c: string) => c.split(";")[0]).join("; ");
}

beforeAll(async () => {
  try {
    db = createDb(TEST_DB_URL);
    await db.execute(sql`SELECT 1`);
    canConnect = true;

    // In-app adapter with a fake publisher — read-model flow needs no Redis.
    registerAdapter(new InAppAdapter({ publish: (c, m) => published.push([c, m]) }));

    const { authRoutes } = await import("../../../../packages/modules/auth/src/routes");
    const { auth } = await import("../../../../packages/modules/auth/src/auth");

    app = new Elysia()
      .use(errorMiddleware)
      .use(authRoutes)
      .use(tenantMiddleware)
      .derive({ as: "scoped" }, (ctx: any) => {
        const tid: string = ctx.tenantId;
        return {
          handlerCtx: {
            tenantId: tid,
            userId: ctx.userId,
            db: scopedDb(db, tid),
            emit: () => {},
            withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tid, fn),
            headers: ctx.request.headers,
          } satisfies HandlerContext,
        };
      })
      .use(notificationRoutes);

    const email = `notif-flow-${Date.now()}@example.com`;
    cookies = await signUpUser(app, email, "testpassword123", "Notif User");

    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) });
    userId = session?.user.id ?? "";
    const orgs = await auth.api.listOrganizations({ headers: new Headers({ cookie: cookies }) });
    tenantId = orgs[0]?.id ?? "";

    if (tenantId) await db.delete(notification).where(eq(notification.tenantId, tenantId));
  } catch (e) {
    console.warn("Setup unavailable -- notifications flow tests skipped:", (e as Error).message);
    canConnect = false;
  }
});

afterAll(async () => {
  if (canConnect && tenantId) {
    await db.delete(notification).where(eq(notification.tenantId, tenantId));
  }
});

describe("Notifications: full HTTP flow", () => {
  test("notify() -> GET list -> unread-count -> mark read (RLS + recipient scoped)", async () => {
    if (!canConnect || !tenantId || !userId) {
      console.warn("SKIPPED: PostgreSQL/tenant setup unavailable");
      return;
    }

    // Seed one notification for the authenticated user via notify().
    const seeded = await notify(
      { type: "system.test", recipients: { userIds: [userId] }, data: { message: "hello-flow" } },
      seedCtx(),
    );
    expect(seeded.success).toBe(true);
    // In-app adapter published the per-user signal.
    expect(published.some(([ch]) => ch === userChannel(tenantId, userId))).toBe(true);

    // GET /api/notifications -> exactly the user's own row.
    const listRes = await app.handle(
      new Request("http://localhost/api/notifications", { headers: { cookie: cookies } }),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0].recipientUserId).toBe(userId);
    expect(listBody.data[0].body).toContain("hello-flow");
    const notifId = listBody.data[0].id as string;

    // unread-count -> 1
    const c1 = await app.handle(
      new Request("http://localhost/api/notifications/unread-count", {
        headers: { cookie: cookies },
      }),
    );
    const c1Body = await c1.json();
    expect(c1Body.success).toBe(true);
    expect(c1Body.data.unread).toBe(1);

    // mark read -> unread-count 0
    const mr = await app.handle(
      new Request(`http://localhost/api/notifications/${notifId}/read`, {
        method: "POST",
        headers: { cookie: cookies },
      }),
    );
    expect(mr.status).toBe(200);
    expect((await mr.json()).success).toBe(true);

    const c2 = await app.handle(
      new Request("http://localhost/api/notifications/unread-count", {
        headers: { cookie: cookies },
      }),
    );
    expect((await c2.json()).data.unread).toBe(0);
  }, 30_000);

  test("GET /api/notifications without session returns 401", async () => {
    if (!canConnect) {
      console.warn("SKIPPED: PostgreSQL unavailable");
      return;
    }
    const res = await app.handle(new Request("http://localhost/api/notifications"));
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("UNAUTHORIZED");
  });

  test("SSE /stream subscribes, receives a published event, and unsubscribes on cancel", async () => {
    if (!canConnect || !tenantId || !userId) {
      console.warn("SKIPPED: PostgreSQL/tenant setup unavailable");
      return;
    }
    if (!process.env.REDIS_URL) {
      console.warn("SKIPPED: REDIS_URL unset — SSE smoke needs Redis");
      return;
    }

    // getSseBridge() lazily builds the runtime bridge AND re-registers the in-app
    // adapter with a REAL Redis publisher, so the notify() below fans out over
    // Redis to this stream.
    const bridge = getSseBridge() as any;
    const channel = userChannel(tenantId, userId);

    const res = await app.handle(
      new Request("http://localhost/api/notifications/stream", { headers: { cookie: cookies } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = (res.body as ReadableStream).getReader();
    const dec = new TextDecoder();

    // First chunk is the SSE comment greeting; start() has begun running.
    const first = await reader.read();
    expect(dec.decode(first.value)).toContain(": connected");

    // Wait for the bridge subscription to fully land — start() awaits
    // sub.subscribe(channel) before adding the emitter, so the emitter set is
    // only populated once the Redis SUBSCRIBE has resolved.
    expect(await waitFor(() => bridge.channels.get(channel)?.size === 1)).toBe(true);
    expect(bridge.channels.get(channel)?.size).toBe(1);

    // Publish via the real in-app adapter (Redis) -> the stream should emit data.
    const sent = await notify(
      { type: "system.test", recipients: { userIds: [userId] }, data: { message: "via-sse" } },
      seedCtx(),
    );
    expect(sent.success).toBe(true);

    const dataChunk = await reader.read();
    const payload = dec.decode(dataChunk.value);
    expect(payload).toContain("data:");
    expect(payload).toContain("notification.created");

    // Client disconnect -> cancel() must fire -> bridge refcount returns to empty.
    await reader.cancel();
    expect(await waitFor(() => !bridge.channels.has(channel))).toBe(true);
    expect(bridge.channels.has(channel)).toBe(false);
  }, 30_000);
});
