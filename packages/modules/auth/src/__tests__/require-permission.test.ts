import { beforeEach, describe, expect, mock, test } from "bun:test";

type HasPermissionArgs = {
  headers: Headers;
  body: { organizationId?: string; permissions: Record<string, string[]> };
};

const mockHasPermission = mock(async (_args: HasPermissionArgs) => ({
  success: true,
  error: null,
}));
const mockGetSession = mock(async (_args: { headers: Headers }) => null as any);

mock.module("../auth", () => ({
  auth: { api: { hasPermission: mockHasPermission, getSession: mockGetSession } },
}));

const { requirePermission } = await import("../middleware");

// Pull the scoped derive handler out of the Elysia plugin so we can call it
// with a synthetic context (no HTTP server needed).
function getDeriveFn(plugin: any): (ctx: any) => Promise<any> {
  const ev = plugin.event?.transform ?? plugin.event?.derive ?? [];
  const fn = (Array.isArray(ev) ? ev : [ev]).map((e: any) => e?.fn ?? e).find(Boolean);
  return fn;
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "org-1",
    userId: "user-1",
    request: { headers: new Headers() },
    ...overrides,
  };
}

describe("requirePermission", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
    mockGetSession.mockReset();
    mockHasPermission.mockResolvedValue({ success: true, error: null });
  });

  test("allows when hasPermission succeeds", async () => {
    const fn = getDeriveFn(requirePermission("files", "write"));
    const result = await fn(ctx());
    expect(mockHasPermission).toHaveBeenCalledTimes(1);
    const arg = mockHasPermission.mock.calls[0][0];
    expect(arg.body.permissions).toEqual({ files: ["write"] });
    expect(arg.body.organizationId).toBe("org-1");
    expect(result.permission).toEqual({ resource: "files", action: "write" });
  });

  test("throws Forbidden when hasPermission denies", async () => {
    mockHasPermission.mockResolvedValue({ success: false, error: null });
    const fn = getDeriveFn(requirePermission("billing", "manage"));
    await expect(fn(ctx())).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  test("throws NoActiveTenant when no org resolvable", async () => {
    const fn = getDeriveFn(requirePermission("files", "read"));
    await expect(fn(ctx({ tenantId: undefined, session: {} }))).rejects.toMatchObject({
      code: "MISSING_TENANT_CONTEXT",
    });
  });

  test("falls back to getSession when ctx lacks user/org", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "u2" },
      session: { activeOrganizationId: "org-2" },
    });
    const fn = getDeriveFn(requirePermission("files", "read"));
    await fn(ctx({ tenantId: undefined, userId: undefined }));
    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockHasPermission.mock.calls[0][0].body.organizationId).toBe("org-2");
  });
});
