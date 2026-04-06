import { describe, test, expect } from "bun:test";
import authModule from "../index";

describe("tenant CRUD registration", () => {
  test("module has create-tenant command", () => {
    expect(authModule.commands?.["auth:create-tenant"]).toBeFunction();
  });

  test("module has update-tenant command", () => {
    expect(authModule.commands?.["auth:update-tenant"]).toBeFunction();
  });

  test("module has delete-tenant command", () => {
    expect(authModule.commands?.["auth:delete-tenant"]).toBeFunction();
  });

  test("module has get-tenant query", () => {
    expect(authModule.queries?.["auth:get-tenant"]).toBeFunction();
  });

  test("module has list-tenants query", () => {
    expect(authModule.queries?.["auth:list-tenants"]).toBeFunction();
  });

  test("module has list-members query", () => {
    expect(authModule.queries?.["auth:list-members"]).toBeFunction();
  });
});
