import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

/**
 * Behavioral tests for the createTenant command handler.
 *
 * Validates mock.module("../auth") correctly intercepts the better-auth
 * import used by create-tenant.ts, preventing real database connections.
 * This pattern is the foundation for all auth handler tests.
 *
 * mock.module path note: "../auth" resolves from commands/create-tenant.ts
 * to auth/src/auth.ts. Bun's mock.module intercepts by resolved path,
 * so mocking "../auth" from the test file works because both resolve to
 * the same auth/src/auth.ts module.
 */

const mockCreateOrganization = mock(() =>
  Promise.resolve({ id: "org-1", name: "Test Org", slug: "test-org" }),
);

// Mock the auth module to intercept better-auth's createOrganization API.
// This prevents real DB/Redis connections at test time.
mock.module("../auth", () => ({
  auth: {
    api: {
      createOrganization: mockCreateOrganization,
    },
  },
}));

// Dynamically import after mock.module setup to ensure interception works
const { createTenant } = await import("../commands/create-tenant");

describe("createTenant", () => {
  beforeEach(() => {
    mockCreateOrganization.mockClear();
    // Reset to default resolved value
    mockCreateOrganization.mockImplementation(() =>
      Promise.resolve({ id: "org-1", name: "Test Org", slug: "test-org" }),
    );
  });

  test("creates tenant and emits tenant.created event", async () => {
    const ctx = createMockContext({ userId: "user-1" });
    const result = await createTenant({ name: "My Company" }, ctx);

    assertResultOk(result);
    expect(result.data).toEqual(
      expect.objectContaining({ id: "org-1", name: "Test Org" }),
    );
    expect(ctx.emit).toHaveBeenCalledWith("tenant.created", {
      tenantId: "org-1",
      createdBy: "user-1",
    });
    expect(mockCreateOrganization).toHaveBeenCalledTimes(1);
  });

  test("returns error when auth.api throws", async () => {
    mockCreateOrganization.mockRejectedValueOnce(
      new Error("Slug already taken"),
    );

    const ctx = createMockContext();
    const result = await createTenant({ name: "Duplicate" }, ctx);

    assertResultErr(result, "Slug already taken");
  });

  test("auto-generates slug from name when slug not provided", async () => {
    const ctx = createMockContext();
    await createTenant({ name: "My Company!" }, ctx);

    expect(mockCreateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ slug: "my-company" }),
      }),
    );
  });
});
