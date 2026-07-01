// packages/modules/notifications/src/lib/__tests__/preferences.test.ts
import { describe, expect, test } from "bun:test";
import { mutedUserSet, PREFERENCE_CHANNELS } from "../preferences";

describe("mutedUserSet", () => {
  test("collects only disabled rows", () => {
    const s = mutedUserSet([
      { userId: "a", enabled: false },
      { userId: "b", enabled: true },
      { userId: "c", enabled: false },
    ]);
    expect([...s].sort()).toEqual(["a", "c"]);
  });

  test("empty input → empty set", () => {
    expect(mutedUserSet([]).size).toBe(0);
  });

  test("all-enabled → empty set", () => {
    expect(mutedUserSet([{ userId: "a", enabled: true }]).size).toBe(0);
  });
});

describe("PREFERENCE_CHANNELS", () => {
  test("email is the only wired channel", () => {
    expect(PREFERENCE_CHANNELS).toEqual(["email"]);
  });
});
