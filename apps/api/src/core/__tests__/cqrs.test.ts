import { describe, expect, it } from "bun:test";
import { CqrsBus } from "../cqrs";
import type { HandlerContext, CommandHandler, QueryHandler } from "@baseworks/shared";
import { ok } from "@baseworks/shared";

const mockCtx: HandlerContext = {
  tenantId: "test-tenant",
  db: {},
  emit: () => {},
};

describe("CqrsBus", () => {
  it("should execute a registered command and return success result", async () => {
    const bus = new CqrsBus();
    const handler: CommandHandler<any, any> = async (input, _ctx) => {
      return ok({ id: "123", title: input.title });
    };

    bus.registerCommand("test:create", handler);
    const result = await bus.execute("test:create", { title: "hello" }, mockCtx);

    expect(result).toEqual({ success: true, data: { id: "123", title: "hello" } });
  });

  it("should return COMMAND_NOT_FOUND for unregistered command", async () => {
    const bus = new CqrsBus();
    const result = await bus.execute("nonexistent:cmd", {}, mockCtx);

    expect(result).toEqual({ success: false, error: "COMMAND_NOT_FOUND" });
  });

  it("should query a registered query and return success result", async () => {
    const bus = new CqrsBus();
    const handler: QueryHandler<any, any> = async (_input, _ctx) => {
      return ok([{ id: "1", title: "item" }]);
    };

    bus.registerQuery("test:list", handler);
    const result = await bus.query("test:list", {}, mockCtx);

    expect(result).toEqual({ success: true, data: [{ id: "1", title: "item" }] });
  });

  it("should return QUERY_NOT_FOUND for unregistered query", async () => {
    const bus = new CqrsBus();
    const result = await bus.query("nonexistent:query", {}, mockCtx);

    expect(result).toEqual({ success: false, error: "QUERY_NOT_FOUND" });
  });
});
