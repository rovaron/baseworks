import { describe, test, expect, mock, beforeEach } from "bun:test";

/**
 * get-profile uses direct DB access (not ctx.db or auth.api).
 * It imports createDb from @baseworks/db, user table, env from @baseworks/config,
 * and eq from drizzle-orm. We must mock all of these at the module level.
 */

const mockSelectResult: unknown[] = [];
const mockWhere = mock(() => ({ limit: mock(() => Promise.resolve(mockSelectResult)) }));
const mockFrom = mock(() => ({ where: mockWhere }));
const mockSelect = mock(() => ({ from: mockFrom }));
const mockDb = { select: mockSelect };

mock.module("@baseworks/config", () => ({
  env: {
    DATABASE_URL: "postgres://test@localhost/test",
    NODE_ENV: "test",
  },
}));

mock.module("@baseworks/db", () => ({
  createDb: () => mockDb,
  user: {
    id: "id",
    name: "name",
    email: "email",
    image: "image",
    emailVerified: "emailVerified",
    createdAt: "createdAt",
  },
}));

mock.module("drizzle-orm", () => ({
  eq: (col: string, val: string) => ({ column: col, value: val }),
}));

const { getProfile } = await import("../queries/get-profile");

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    db: {},
    emit: mock(() => {}),
    ...overrides,
  };
}

describe("getProfile", () => {
  beforeEach(() => {
    mockSelect.mockClear();
    mockFrom.mockClear();
    mockWhere.mockClear();
    mockSelectResult.length = 0;
  });

  test("returns user profile when found", async () => {
    const profile = {
      id: "user-1",
      name: "Test User",
      email: "test@test.com",
      image: null,
      emailVerified: true,
      createdAt: new Date("2024-01-01"),
    };
    mockSelectResult.push(profile);

    const result = await getProfile({}, createMockCtx({ userId: "user-1" }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(profile);
    }
    expect(mockSelect).toHaveBeenCalled();
  });

  test("returns error when user not authenticated (no userId)", async () => {
    const result = await getProfile(
      {},
      createMockCtx({ userId: undefined }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("Not authenticated");
    }
    // Should not attempt DB query
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test("returns error when user not found in db", async () => {
    // mockSelectResult is empty (no push), so db returns []
    const result = await getProfile({}, createMockCtx({ userId: "user-1" }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("User not found");
    }
  });
});
