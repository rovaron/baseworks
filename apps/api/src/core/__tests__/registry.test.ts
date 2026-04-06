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
