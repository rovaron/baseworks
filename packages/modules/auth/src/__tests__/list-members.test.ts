import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { auth as realAuth } from "../auth";

type FullOrg = NonNullable<Awaited<ReturnType<typeof realAuth.api.getFullOrganization>>>;
type Member = FullOrg["members"][number];
// Production reads `org.members || []`, so a provider response may omit members.
// This variant models that runtime possibility without weakening FullOrg itself.
type FullOrgMaybeMembers = Omit<FullOrg, "members"> & { members?: FullOrg["members"] };

const mockGetFullOrganization = mock(
  (): Promise<FullOrgMaybeMembers | null> => Promise.resolve(null),
);

mock.module("../auth", () => ({
  auth: {
    api: {
      getFullOrganization: mockGetFullOrganization,
    },
  },
}));

const { listMembers } = await import("../queries/list-members");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("listMembers", () => {
  beforeEach(() => {
    mockGetFullOrganization.mockReset();
  });

  test("returns members list for tenant", async () => {
    const members: Member[] = [
      {
        id: "mem-1",
        organizationId: "org-1",
        userId: "user-1",
        role: "owner",
        createdAt: new Date(),
        user: { id: "user-1", email: "owner@test.com", name: "Owner" },
      },
      {
        id: "mem-2",
        organizationId: "org-1",
        userId: "user-2",
        role: "member",
        createdAt: new Date(),
        user: { id: "user-2", email: "member@test.com", name: "Member" },
      },
    ];
    mockGetFullOrganization.mockResolvedValueOnce({
      id: "org-1",
      name: "Test Org",
      slug: "test-org",
      createdAt: new Date(),
      invitations: [],
      members,
    });

    const result = await listMembers({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(members);
      expect(result.data).toHaveLength(2);
    }
  });

  test("returns empty array when org has no members field", async () => {
    mockGetFullOrganization.mockResolvedValueOnce({
      id: "org-1",
      name: "Test Org",
      slug: "test-org",
      createdAt: new Date(),
      invitations: [],
      members: undefined,
    });

    const result = await listMembers({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("returns error when tenant not found", async () => {
    mockGetFullOrganization.mockResolvedValueOnce(null);

    const result = await listMembers({ organizationId: "nonexistent" }, createMockCtx());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Tenant not found");
    }
  });

  test("returns error when auth.api throws", async () => {
    mockGetFullOrganization.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await listMembers({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Connection refused");
    }
  });
});
