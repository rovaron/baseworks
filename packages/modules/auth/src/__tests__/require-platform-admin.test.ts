// packages/modules/auth/src/__tests__/require-platform-admin.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockGetSession = mock(async () => null as any);
mock.module("../auth", () => ({ auth: { api: { getSession: mockGetSession } } }));

const { requirePlatformAdmin } = await import("../middleware");

function getDeriveFn(plugin: any) {
  const ev = plugin.event?.transform ?? plugin.event?.derive ?? [];
  return (Array.isArray(ev) ? ev : [ev]).map((e: any) => e?.fn ?? e).find(Boolean);
}
const ctx = () => ({ request: { headers: new Headers() } });

describe("requirePlatformAdmin", () => {
  beforeEach(() => mockGetSession.mockReset());

  test("401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(getDeriveFn(requirePlatformAdmin())(ctx())).rejects.toMatchObject({ status: 401 });
  });

  test("403 when user.role is not admin", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u", role: "user" }, session: {} });
    await expect(getDeriveFn(requirePlatformAdmin())(ctx())).rejects.toMatchObject({ status: 403 });
  });

  test("allows when user.role is admin", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u", role: "admin" }, session: {} });
    const res = await getDeriveFn(requirePlatformAdmin())(ctx());
    expect(res.isPlatformAdmin).toBe(true);
  });
});
