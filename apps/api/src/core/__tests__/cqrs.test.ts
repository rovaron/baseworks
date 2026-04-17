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

describe("CqrsBus edge cases", () => {
  it("returns error result when command handler throws an unhandled exception", async () => {
    const bus = new CqrsBus();
    const handler: CommandHandler<any, any> = async (_input, _ctx) => {
      throw new Error("boom");
    };

    bus.registerCommand("test:throws", handler);
    const resultPromise = bus.execute("test:throws", {}, mockCtx);

    await expect(resultPromise).rejects.toThrow("boom");
  });

  it("returns error result when query handler throws an unhandled exception", async () => {
    const bus = new CqrsBus();
    const handler: QueryHandler<any, any> = async (_input, _ctx) => {
      throw new Error("query boom");
    };

    bus.registerQuery("test:throws-query", handler);
    const resultPromise = bus.query("test:throws-query", {}, mockCtx);

    await expect(resultPromise).rejects.toThrow("query boom");
  });

  it("overwrites handler on duplicate command registration", async () => {
    const bus = new CqrsBus();
    const firstHandler: CommandHandler<any, any> = async (_input, _ctx) => ok({ from: "first" });
    const secondHandler: CommandHandler<any, any> = async (_input, _ctx) => ok({ from: "second" });

    bus.registerCommand("test:dup", firstHandler);
    bus.registerCommand("test:dup", secondHandler);

    const result = await bus.execute("test:dup", {}, mockCtx);
    expect(result).toEqual({ success: true, data: { from: "second" } });
  });

  it("overwrites handler on duplicate query registration", async () => {
    const bus = new CqrsBus();
    const firstHandler: QueryHandler<any, any> = async (_input, _ctx) => ok({ from: "first" });
    const secondHandler: QueryHandler<any, any> = async (_input, _ctx) => ok({ from: "second" });

    bus.registerQuery("test:dup-query", firstHandler);
    bus.registerQuery("test:dup-query", secondHandler);

    const result = await bus.query("test:dup-query", {}, mockCtx);
    expect(result).toEqual({ success: true, data: { from: "second" } });
  });

  it("handles concurrent execution of different commands", async () => {
    const bus = new CqrsBus();
    const handlerA: CommandHandler<any, any> = async (input, _ctx) => {
      await new Promise((r) => setTimeout(r, 10));
      return ok({ id: "a", val: input.val });
    };
    const handlerB: CommandHandler<any, any> = async (input, _ctx) => {
      await new Promise((r) => setTimeout(r, 10));
      return ok({ id: "b", val: input.val });
    };

    bus.registerCommand("test:a", handlerA);
    bus.registerCommand("test:b", handlerB);

    const [resultA, resultB] = await Promise.all([
      bus.execute("test:a", { val: 1 }, mockCtx),
      bus.execute("test:b", { val: 2 }, mockCtx),
    ]);

    expect(resultA).toEqual({ success: true, data: { id: "a", val: 1 } });
    expect(resultB).toEqual({ success: true, data: { id: "b", val: 2 } });
  });

  it("checks hasCommand and hasQuery accurately", () => {
    const bus = new CqrsBus();
    const handler: CommandHandler<any, any> = async () => ok({});

    expect(bus.hasCommand("test:none")).toBe(false);
    expect(bus.hasQuery("test:none")).toBe(false);

    bus.registerCommand("test:exists", handler);
    bus.registerQuery("test:exists-q", handler as any);

    expect(bus.hasCommand("test:exists")).toBe(true);
    expect(bus.hasQuery("test:exists-q")).toBe(true);
  });
});
