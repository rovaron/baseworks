import { beforeEach, describe, expect, mock, test } from "bun:test";

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
      // Phase 29 / IDA-01 — DTO is additive: avatarUrl is null when ctx.dispatch
      // is absent (this bare-ctx mock has none), no throw.
      expect(result.data).toEqual({ ...profile, avatarUrl: null });
    }
    expect(mockSelect).toHaveBeenCalled();
  });

  test("returns error when user not authenticated (no userId)", async () => {
    const result = await getProfile({}, createMockCtx({ userId: undefined }));

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

describe("getProfile — avatarUrl via ctx.dispatch (Phase 29 / IDA-01)", () => {
  const profile = {
    id: "user-1",
    name: "Test User",
    email: "test@test.com",
    image: null,
    emailVerified: true,
    createdAt: new Date("2024-01-01"),
  };

  beforeEach(() => {
    mockSelect.mockClear();
    mockSelectResult.length = 0;
  });

  test("resolves the signed URL of the LATEST uploaded/ready file (latest-wins)", async () => {
    mockSelectResult.push(profile);
    const dispatched: Array<{ command: string; input: any }> = [];
    const dispatch = async (command: string, input: unknown) => {
      dispatched.push({ command, input: input as any });
      if (command === "files:list-for-record") {
        // ORDER BY created_at ASC → last usable is the latest.
        return {
          success: true,
          data: {
            files: [
              { fileId: "f0", status: "pending" },
              { fileId: "f1", status: "uploaded" },
              { fileId: "f2", status: "ready" },
            ],
          },
        };
      }
      if (command === "files:get-read-url") {
        return { success: true, data: { url: "https://signed.example/avatar?sig=xyz" } };
      }
      return { success: false, error: "COMMAND_NOT_FOUND" };
    };

    const result = await getProfile({}, createMockCtx({ userId: "user-1", dispatch }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        ...profile,
        avatarUrl: "https://signed.example/avatar?sig=xyz",
      });
    }
    // list called with the auth/user owner tuple; read-url called for the latest (f2).
    expect(dispatched[0]).toEqual({
      command: "files:list-for-record",
      input: { ownerModule: "auth", ownerRecordType: "user", recordId: "user-1" },
    });
    expect(dispatched[1]).toEqual({
      command: "files:get-read-url",
      input: { fileId: "f2" },
    });
  });

  test("avatarUrl is null when no uploaded/ready file exists (no read-url call)", async () => {
    mockSelectResult.push(profile);
    const dispatched: string[] = [];
    const dispatch = async (command: string) => {
      dispatched.push(command);
      if (command === "files:list-for-record") {
        return { success: true, data: { files: [{ fileId: "f0", status: "pending" }] } };
      }
      return { success: false, error: "COMMAND_NOT_FOUND" };
    };

    const result = await getProfile({}, createMockCtx({ userId: "user-1", dispatch }));

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avatarUrl).toBeNull();
    expect(dispatched).toEqual(["files:list-for-record"]); // never reached get-read-url
  });

  test("avatarUrl is null when the list dispatch fails", async () => {
    mockSelectResult.push(profile);
    const dispatch = async () => ({ success: false, error: "not_found" });

    const result = await getProfile({}, createMockCtx({ userId: "user-1", dispatch }));

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avatarUrl).toBeNull();
  });
});
