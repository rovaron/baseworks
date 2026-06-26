// packages/modules/notifications/src/__integration__/read-model.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, notification } from "@baseworks/db";
import { eq, sql } from "drizzle-orm";
import { InAppAdapter } from "../channels/in-app";
import { registerAdapter } from "../channels/registry";
import { markAllRead } from "../commands/mark-all-read";
import { markRead } from "../commands/mark-read";
import { notify } from "../commands/notify";
import { listNotifications } from "../queries/list-notifications";
import { unreadCount } from "../queries/unread-count";
import { makeCtx } from "./_ctx";

const T = "notif-readmodel-tenant";
const A = "user-a";
const B = "user-b";
let ok = false;

beforeAll(async () => {
  const rlsUrl = process.env.DATABASE_URL_RLS;
  if (!rlsUrl || rlsUrl === process.env.DATABASE_URL) return;
  try {
    await getDb().execute(sql`select 1`);
    registerAdapter(new InAppAdapter({ publish: () => {} }));
    // Clean slate for re-runs.
    await getDb().delete(notification).where(eq(notification.tenantId, T));
    ok = true;
  } catch {
    ok = false;
  }
});
afterAll(async () => {
  if (ok) await getDb().delete(notification).where(eq(notification.tenantId, T));
});

describe("notification read model", () => {
  test("per-recipient isolation, unread-count, mark-read, mark-all-read", async () => {
    if (!ok) return console.warn("SKIPPED");

    // Seed: two notifications for A, one for B — same tenant.
    const ctxA = makeCtx(T, A);
    const ctxB = makeCtx(T, B);
    expect(
      (
        await notify(
          { type: "system.test", recipients: { userIds: [A] }, data: { message: "a-one" } },
          ctxA,
        )
      ).success,
    ).toBe(true);
    expect(
      (
        await notify(
          { type: "system.test", recipients: { userIds: [A] }, data: { message: "a-two" } },
          ctxA,
        )
      ).success,
    ).toBe(true);
    expect(
      (
        await notify(
          { type: "system.test", recipients: { userIds: [B] }, data: { message: "b-one" } },
          ctxB,
        )
      ).success,
    ).toBe(true);

    // A lists only A's rows (B's row excluded despite same tenant).
    const listA = await listNotifications({}, ctxA);
    expect(listA.success).toBe(true);
    if (!listA.success) throw new Error("listA failed");
    expect(listA.data.length).toBe(2);
    expect(listA.data.every((n) => n.recipientUserId === A)).toBe(true);
    expect(listA.data.map((n) => n.body).sort()).toEqual(["a-one", "a-two"]);

    // B lists only B's row.
    const listB = await listNotifications({}, ctxB);
    expect(listB.success).toBe(true);
    if (!listB.success) throw new Error("listB failed");
    expect(listB.data.length).toBe(1);
    expect(listB.data[0]?.recipientUserId).toBe(B);
    expect(listB.data[0]?.body).toBe("b-one");

    // Unread counts are per-recipient.
    const countA0 = await unreadCount({}, ctxA);
    expect(countA0.success && countA0.data.unread).toBe(2);
    const countB0 = await unreadCount({}, ctxB);
    expect(countB0.success && countB0.data.unread).toBe(1);

    // Mark one of A's read → A unread drops to 1, B unchanged.
    const targetId = listA.data[0]?.id as string;
    const mr = await markRead({ id: targetId }, ctxA);
    expect(mr.success).toBe(true);
    const countA1 = await unreadCount({}, ctxA);
    expect(countA1.success && countA1.data.unread).toBe(1);
    const countB1 = await unreadCount({}, ctxB);
    expect(countB1.success && countB1.data.unread).toBe(1);

    // A cannot mark B's notification (recipient predicate): B's row stays unread.
    const bId = listB.data[0]?.id as string;
    await markRead({ id: bId }, ctxA);
    const countBAfterCross = await unreadCount({}, ctxB);
    expect(countBAfterCross.success && countBAfterCross.data.unread).toBe(1);

    // unreadOnly filter returns only the still-unread A row.
    const unreadListA = await listNotifications({ unreadOnly: true }, ctxA);
    expect(unreadListA.success).toBe(true);
    if (!unreadListA.success) throw new Error("unreadListA failed");
    expect(unreadListA.data.length).toBe(1);
    expect(unreadListA.data[0]?.readAt).toBeNull();

    // Mark all read for A → A unread 0, B still 1.
    const mar = await markAllRead({}, ctxA);
    expect(mar.success).toBe(true);
    const countA2 = await unreadCount({}, ctxA);
    expect(countA2.success && countA2.data.unread).toBe(0);
    const countB2 = await unreadCount({}, ctxB);
    expect(countB2.success && countB2.data.unread).toBe(1);
  }, 30_000);
});
