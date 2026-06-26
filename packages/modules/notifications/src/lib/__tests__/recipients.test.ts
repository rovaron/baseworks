import { describe, expect, test } from "bun:test";
import { resolveRecipients } from "../recipients";

function ctxWith(members: Array<{ userId: string; role: string }>) {
  return {
    tenantId: "t1",
    dispatch: async (cmd: string) =>
      cmd === "auth:list-members"
        ? { success: true, data: members }
        : { success: false, error: "unexpected" },
  } as any;
}

describe("resolveRecipients", () => {
  test("explicit userIds pass through, deduped", async () => {
    const ids = await resolveRecipients({ userIds: ["a", "a", "b"] }, ctxWith([]));
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
  test("role selects matching members", async () => {
    const ids = await resolveRecipients(
      { role: "owner" },
      ctxWith([
        { userId: "a", role: "owner" },
        { userId: "b", role: "member" },
      ]),
    );
    expect([...ids]).toEqual(["a"]);
  });
  test("userIds + role union", async () => {
    const ids = await resolveRecipients(
      { userIds: ["x"], role: "owner" },
      ctxWith([{ userId: "a", role: "owner" }]),
    );
    expect([...ids].sort()).toEqual(["a", "x"]);
  });
});
