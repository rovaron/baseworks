import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { auth as realAuth } from "../auth";

type Org = Awaited<ReturnType<typeof realAuth.api.listOrganizations>>[number];

// `| null` mirrors the production guard `ok(orgs || [])`: the provider may
// return null, which the query coerces to an empty array.
const mockListOrganizations = mock((): Promise<Org[] | null> => Promise.resolve([]));

mock.module("../auth", () => ({
  auth: {
    api: {
      listOrganizations: mockListOrganizations,
    },
  },
}));

const { listTenants } = await import("../queries/list-tenants");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("listTenants", () => {
  beforeEach(() => {
    mockListOrganizations.mockReset();
  });

  test("returns list of tenants", async () => {
    const orgs: Org[] = [
      { id: "org-1", name: "Org One", slug: "org-one", createdAt: new Date() },
      { id: "org-2", name: "Org Two", slug: "org-two", createdAt: new Date() },
    ];
    mockListOrganizations.mockResolvedValueOnce(orgs);

    const result = await listTenants({}, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(orgs);
      expect(result.data).toHaveLength(2);
    }
  });

  test("returns empty array when user has no tenants", async () => {
    mockListOrganizations.mockResolvedValueOnce([]);

    const result = await listTenants({}, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
      expect(result.data).toHaveLength(0);
    }
  });

  test("returns ok with empty array when auth.api returns null", async () => {
    mockListOrganizations.mockResolvedValueOnce(null);

    const result = await listTenants({}, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("returns error when auth.api throws", async () => {
    mockListOrganizations.mockRejectedValueOnce(new Error("Service unavailable"));

    const result = await listTenants({}, createMockCtx());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Service unavailable");
    }
  });
});
