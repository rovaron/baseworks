import { describe, test, expect } from "bun:test";
import { createExample } from "../commands/create-example";
import { createMockContext, createMockDb } from "../../../__test-utils__/mock-context";
import { assertResultOk } from "../../../__test-utils__/assert-result";

/**
 * Behavioral tests for the createExample command handler.
 *
 * Closes the Wave 0 testing gap for Phase 15 Plan 02 by exercising the
 * existing createExample command. No mock.module(...) blocks are needed
 * because create-example.ts imports only @sinclair/typebox, @baseworks/shared,
 * and @baseworks/db -- none of which pull in env/postgres/stripe/redis.
 *
 * Import path convention (Phase 14): tests reach into the shared test-utils
 * via the relative path "../../../__test-utils__/*" rather than a workspace
 * package import -- no dedicated test-utils workspace package exists.
 */

describe("createExample", () => {
  test("inserts a row and returns success Result", async () => {
    const inserted = {
      id: "ex-1",
      title: "Hello",
      description: null,
      tenantId: "test-tenant-id",
    };
    const ctx = createMockContext({
      db: createMockDb({ insert: [inserted] }),
    });

    const result = await createExample({ title: "Hello" }, ctx);

    const data = assertResultOk(result);
    expect(data).toEqual(inserted);
  });

  test("emits example.created with inserted id and tenantId", async () => {
    const inserted = {
      id: "ex-2",
      title: "World",
      description: null,
      tenantId: "test-tenant-id",
    };
    const ctx = createMockContext({
      db: createMockDb({ insert: [inserted] }),
    });

    await createExample({ title: "World" }, ctx);

    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("example.created", {
      id: "ex-2",
      tenantId: "test-tenant-id",
    });
  });

  test("accepts optional description and passes it through", async () => {
    const inserted = {
      id: "ex-3",
      title: "With desc",
      description: "A longer body",
      tenantId: "test-tenant-id",
    };
    const ctx = createMockContext({
      db: createMockDb({ insert: [inserted] }),
    });

    const result = await createExample(
      { title: "With desc", description: "A longer body" },
      ctx,
    );

    const data = assertResultOk(result);
    expect(data.description).toBe("A longer body");
  });
});
