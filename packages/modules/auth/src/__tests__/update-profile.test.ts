import { describe, test, expect, mock, beforeEach } from "bun:test";
import { createMockContext } from "../../../__test-utils__/mock-context";
import { assertResultOk, assertResultErr } from "../../../__test-utils__/assert-result";

const mockUpdateUser = mock(() => Promise.resolve({ updated: true }));
const mockChangePassword = mock(() => Promise.resolve({ changed: true }));

mock.module("../auth", () => ({
  auth: {
    api: {
      updateUser: mockUpdateUser,
      changePassword: mockChangePassword,
    },
  },
}));

const { updateProfile } = await import("../commands/update-profile");

describe("updateProfile", () => {
  beforeEach(() => {
    mockUpdateUser.mockClear();
    mockChangePassword.mockClear();
  });

  test("updates user name successfully", async () => {
    const ctx = createMockContext();
    const input = { name: "New Name" };

    const result = await updateProfile(input, ctx);
    const data = assertResultOk(result);

    expect(data).toEqual({ updated: true });
    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      body: { name: "New Name" },
      headers: expect.any(Headers),
    });
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  test("changes password when currentPassword and newPassword provided", async () => {
    const ctx = createMockContext();
    const input = {
      currentPassword: "old-pass-123",
      newPassword: "new-pass-456",
    };

    const result = await updateProfile(input, ctx);
    assertResultOk(result);

    expect(mockChangePassword).toHaveBeenCalledTimes(1);
    expect(mockChangePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: "old-pass-123",
        newPassword: "new-pass-456",
      },
      headers: expect.any(Headers),
    });
  });

  test("returns error when auth.api throws", async () => {
    mockUpdateUser.mockRejectedValueOnce(new Error("Update failed"));
    const ctx = createMockContext();
    const input = { name: "Will Fail" };

    const result = await updateProfile(input, ctx);
    const error = assertResultErr(result);

    expect(error).toBe("Update failed");
  });
});
