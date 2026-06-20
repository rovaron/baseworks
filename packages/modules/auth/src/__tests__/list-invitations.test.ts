import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { auth as realAuth } from "../auth";

type Invitation = Awaited<ReturnType<typeof realAuth.api.listInvitations>>[number];

// `| null` mirrors the production guard `ok(invitations || [])`: the provider
// may return null, which the query coerces to an empty array.
const mockListInvitations = mock((): Promise<Invitation[] | null> => Promise.resolve([]));

mock.module("../auth", () => ({
  auth: {
    api: {
      listInvitations: mockListInvitations,
    },
  },
}));

const { listInvitations } = await import("../queries/list-invitations");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("listInvitations", () => {
  beforeEach(() => {
    mockListInvitations.mockReset();
  });

  test("returns invitations list", async () => {
    const invitations: Invitation[] = [
      {
        id: "inv-1",
        organizationId: "org-1",
        email: "a@test.com",
        role: "member",
        status: "pending",
        inviterId: "user-9",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: "inv-2",
        organizationId: "org-1",
        email: "b@test.com",
        role: "admin",
        status: "pending",
        inviterId: "user-9",
        expiresAt: new Date(),
        createdAt: new Date(),
      },
    ];
    mockListInvitations.mockResolvedValueOnce(invitations);

    const result = await listInvitations({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(invitations);
      expect(result.data).toHaveLength(2);
    }
    expect(mockListInvitations).toHaveBeenCalledWith({
      query: { organizationId: "org-1" },
      headers: expect.any(Headers),
    });
  });

  test("returns empty array when no invitations", async () => {
    mockListInvitations.mockResolvedValueOnce([]);

    const result = await listInvitations({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
      expect(result.data).toHaveLength(0);
    }
  });

  test("returns ok with empty array when auth.api returns null", async () => {
    mockListInvitations.mockResolvedValueOnce(null);

    const result = await listInvitations({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  test("returns error when auth.api throws", async () => {
    mockListInvitations.mockRejectedValueOnce(new Error("Permission denied"));

    const result = await listInvitations({ organizationId: "org-1" }, createMockCtx());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Permission denied");
    }
  });
});
