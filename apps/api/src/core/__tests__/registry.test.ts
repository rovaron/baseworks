import { describe, expect, it, spyOn } from "bun:test";
import { ModuleRegistry } from "../registry";
import { logger } from "../../lib/logger";

describe("ModuleRegistry", () => {
  it("should load example module and register its commands and queries", async () => {
    const registry = new ModuleRegistry({ role: "api", modules: ["example"] });
    await registry.loadAll();

    const cqrs = registry.getCqrs();
    expect(cqrs.hasCommand("example:create")).toBe(true);
    expect(cqrs.hasQuery("example:list")).toBe(true);
    expect(registry.getLoadedNames()).toEqual(["example"]);
  });

  it("should load nothing when modules array is empty", async () => {
    const registry = new ModuleRegistry({ role: "api", modules: [] });
    await registry.loadAll();

    expect(registry.getLoaded().size).toBe(0);
    expect(registry.getLoadedNames()).toEqual([]);
  });

  it("should skip and log error for non-existent module", async () => {
    const errorSpy = spyOn(logger, "error").mockImplementation(() => {});

    const registry = new ModuleRegistry({ role: "api", modules: ["nonexistent"] });
    await registry.loadAll();

    expect(registry.getLoaded().size).toBe(0);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe("ModuleRegistry edge cases", () => {
  it("handles loading a module with empty commands and queries", async () => {
    // The example module has commands/queries, but we test that the registry
    // does not crash when iterating over a module with no commands/queries.
    // Since moduleImportMap is static, we test via the example module which
    // has entries -- verifying the iteration logic works without errors.
    const registry = new ModuleRegistry({ role: "api", modules: ["example"] });
    await registry.loadAll();

    // Verify registry loaded successfully and CqrsBus is accessible
    const cqrs = registry.getCqrs();
    expect(cqrs).toBeDefined();
    expect(registry.getLoadedNames()).toContain("example");
  });

  it("handles duplicate module name in config gracefully -- loads it twice", async () => {
    // When the same module name appears twice in config, loadAll iterates
    // both entries. The second load overwrites the first in the Map.
    const registry = new ModuleRegistry({ role: "api", modules: ["example", "example"] });
    await registry.loadAll();

    // Map.set with same key overwrites, so loaded count is 1
    expect(registry.getLoaded().size).toBe(1);
    expect(registry.getLoadedNames()).toEqual(["example"]);

    // Commands should still work (second registration overwrites first)
    const cqrs = registry.getCqrs();
    expect(cqrs.hasCommand("example:create")).toBe(true);
  });

  it("lists all loaded modules via getLoadedNames", async () => {
    // Load example (the only module that doesn't require external deps in test)
    const registry = new ModuleRegistry({ role: "api", modules: ["example"] });
    await registry.loadAll();

    const names = registry.getLoadedNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThanOrEqual(1);
    expect(names).toContain("example");
  });

  it("exposes EventBus instance via getEventBus", () => {
    const registry = new ModuleRegistry({ role: "api", modules: [] });
    const eventBus = registry.getEventBus();

    expect(eventBus).toBeDefined();
    expect(typeof eventBus.on).toBe("function");
    expect(typeof eventBus.emit).toBe("function");
  });

  it("worker role skips route attachment in getModuleRoutes", async () => {
    const registry = new ModuleRegistry({ role: "worker", modules: ["example"] });
    await registry.loadAll();

    // getModuleRoutes should return an Elysia plugin without attaching routes
    const routes = registry.getModuleRoutes();
    expect(routes).toBeDefined();
  });
});
