import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { HealthContributor, ModuleDefinition } from "@baseworks/shared";
import { HealthAggregator } from "../health-aggregator";
import { ModuleRegistry } from "../registry";

describe("ModuleRegistry — health aggregator wiring (OPS-04)", () => {
  test("getHealthAggregator() returns a HealthAggregator instance", () => {
    const registry = new ModuleRegistry({ role: "api", modules: [] });
    const agg = registry.getHealthAggregator();
    expect(agg).toBeInstanceOf(HealthAggregator);
  });

  test("getHealthAggregator() returns the same instance across calls (singleton)", () => {
    const registry = new ModuleRegistry({ role: "api", modules: [] });
    expect(registry.getHealthAggregator()).toBe(registry.getHealthAggregator());
  });
});

describe("ModuleRegistry — loadAll() collects def.health", () => {
  afterEach(() => {
    mock.restore();
  });

  test("loadAll() registers a contributor for a module that ships def.health", async () => {
    const myHealth: HealthContributor = {
      name: "fake-module",
      check: async () => ({ status: "healthy" }),
    };
    const fakeModule: ModuleDefinition = {
      name: "fake-module",
      health: myHealth,
    };

    // bun:test mock.module replaces the module for subsequent dynamic imports.
    // The static import map in registry.ts calls () => import("@baseworks/module-auth"),
    // so mocking that specifier intercepts the dynamic import.
    mock.module("@baseworks/module-auth", () => ({ default: fakeModule }));

    const registry = new ModuleRegistry({ role: "api", modules: ["auth"] });
    await registry.loadAll();

    const contributors = registry.getHealthAggregator().getContributors();
    expect(contributors.length).toBe(1);
    expect(contributors[0].name).toBe("fake-module");
  });

  test("loadAll() does NOT register a contributor for modules without def.health", async () => {
    const fakeModule: ModuleDefinition = {
      name: "no-health-module",
      // no health field
    };
    mock.module("@baseworks/module-auth", () => ({ default: fakeModule }));

    const registry = new ModuleRegistry({ role: "api", modules: ["auth"] });
    await registry.loadAll();

    expect(registry.getHealthAggregator().getContributors().length).toBe(0);
  });
});
