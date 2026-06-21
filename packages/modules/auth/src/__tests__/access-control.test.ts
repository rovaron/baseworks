import { describe, expect, test } from "bun:test";
import { ac, admin, member, owner, statements } from "../access-control";

describe("access-control catalog", () => {
  test("statements include baseworks + better-auth defaults", () => {
    expect(statements.files).toEqual(["read", "write", "delete", "admin"]);
    expect(statements.billing).toEqual(["read", "manage"]);
    // better-auth defaults merged in
    expect(statements.organization).toBeDefined();
    expect(statements.member).toBeDefined();
    expect(statements.invitation).toBeDefined();
    expect(statements.ac).toBeDefined();
  });

  test("owner has full files + billing", () => {
    expect(owner.statements.files).toEqual(["read", "write", "delete", "admin"]);
    expect(owner.statements.billing).toEqual(["read", "manage"]);
  });

  test("member is read-only baseline", () => {
    expect(member.statements.files).toEqual(["read"]);
    expect(member.statements.billing).toEqual(["read"]);
  });

  test("admin omits destructive + billing:manage + ac:delete", () => {
    expect(admin.statements.files).toEqual(["read", "write", "delete", "admin"]);
    expect(admin.statements.billing).toEqual(["read"]);
    expect(admin.statements.organization ?? []).not.toContain("delete");
    expect(admin.statements.ac ?? []).not.toContain("delete");
  });

  test("ac is a usable AccessControl (newRole works)", () => {
    const r = ac.newRole({ files: ["read"] });
    expect(r.statements.files).toEqual(["read"]);
  });
});
