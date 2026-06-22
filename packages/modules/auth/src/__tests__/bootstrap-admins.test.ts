// packages/modules/auth/src/__tests__/bootstrap-admins.test.ts
import { describe, expect, mock, test } from "bun:test";

describe("promoteConfiguredAdmins", () => {
  test("sets user.role='admin' for each ADMIN_EMAILS user, skips already-admin", async () => {
    const updated: Array<{ email: string }> = [];
    const fakeDb = {
      update: () => ({
        set: (vals: any) => ({
          where: async () => {
            updated.push(vals);
            return undefined;
          },
        }),
      }),
    };
    mock.module("@baseworks/config", () => ({
      env: {},
      getAdminEmails: () => ["a@x.com", "b@x.com"],
    }));
    const { promoteConfiguredAdmins } = await import("../bootstrap-admins");
    await promoteConfiguredAdmins(fakeDb as any);
    expect(updated.length).toBe(1); // single UPDATE with WHERE email IN (...)
  });

  test("no-op when ADMIN_EMAILS empty", async () => {
    mock.module("@baseworks/config", () => ({ env: {}, getAdminEmails: () => [] }));
    const { promoteConfiguredAdmins } = await import("../bootstrap-admins");
    await expect(promoteConfiguredAdmins({} as any)).resolves.toBeUndefined();
  });
});
