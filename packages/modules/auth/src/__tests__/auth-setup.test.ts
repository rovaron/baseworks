import { describe, test, expect } from "bun:test";
import authModule from "../index";
import * as authSchema from "@baseworks/db/src/schema/auth";

describe("auth module setup", () => {
  test("module definition has correct name", () => {
    expect(authModule.name).toBe("auth");
  });

  test("module definition has routes", () => {
    expect(authModule.routes).toBeTruthy();
  });

  test("module definition declares events", () => {
    expect(authModule.events).toContain("user.created");
    expect(authModule.events).toContain("tenant.created");
  });

  test("auth schema exports all required tables", () => {
    expect(authSchema.user).toBeDefined();
    expect(authSchema.session).toBeDefined();
    expect(authSchema.account).toBeDefined();
    expect(authSchema.verification).toBeDefined();
    expect(authSchema.organization).toBeDefined();
    expect(authSchema.member).toBeDefined();
    expect(authSchema.invitation).toBeDefined();
  });

  test("auth instance and middleware are exported", async () => {
    const mod = await import("../index");
    expect(mod.auth).toBeDefined();
    expect(mod.betterAuthPlugin).toBeDefined();
    expect(mod.requireRole).toBeDefined();
  });
});
