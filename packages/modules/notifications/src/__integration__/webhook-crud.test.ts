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
    const badUrl = await createWebhook(
      { url: "http://example.com/hook", categories: ["system"] },
      ctx,
    );
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

  test("admin_disabled endpoint is fully locked from tenant commands", async () => {
    if (!ok) return console.warn("SKIPPED");
    const ctx = makeCtx(T, "u1");
    const url = "https://example.com/hook";
    const created = await createWebhook({ url, categories: ["system"] }, ctx);
    if (!created.success) throw new Error("setup failed");
    const id = created.data.id;
    // Simulate a platform-admin force-disable (the locked state).
    await getDb()
      .update(notificationWebhook)
      .set({ status: "admin_disabled", disabledReason: "Force-disabled by platform admin: abuse" })
      .where(eq(notificationWebhook.id, id));

    // Re-enable — rejected.
    const reenable = await updateWebhook({ id, status: "active" }, ctx);
    expect(reenable.success).toBe(false);
    if (!reenable.success) expect(reenable.error).toBe("WEBHOOK_ADMIN_LOCKED");

    // Any other edit — rejected.
    const edit = await updateWebhook({ id, description: "sneaky" }, ctx);
    expect(edit.success).toBe(false);

    // Rotate secret — rejected.
    const rotated = await rotateWebhookSecret({ id }, ctx);
    expect(rotated.success).toBe(false);

    // Delete — rejected (can't erase the audit trail and recreate).
    const removed = await deleteWebhook({ id }, ctx);
    expect(removed.success).toBe(false);

    // Re-register the SAME url as a fresh endpoint — rejected.
    const recreate = await createWebhook({ url, categories: ["system"] }, ctx);
    expect(recreate.success).toBe(false);

    // The locked row is still there, untouched, and active dispatch can't pick it up.
    const [row] = await getDb()
      .select()
      .from(notificationWebhook)
      .where(eq(notificationWebhook.id, id));
    expect(row.status).toBe("admin_disabled");
  }, 30_000);
});
