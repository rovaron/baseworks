import type { ModuleDefinition } from "@baseworks/shared";
import type { Elysia } from "elysia";
import { logger } from "../lib/logger";
import { CqrsBus } from "./cqrs";
import { TypedEventBus } from "./event-bus";

/**
 * Static import map for modules. Ensures imports are statically analyzable by Bun.
 * Future modules are added here -- no arbitrary string-based dynamic imports.
 */
const moduleImportMap: Record<string, () => Promise<any>> = {
  example: () => import("@baseworks/module-example"),
  auth: () => import("@baseworks/module-auth"),
  // Future modules added here:
  // billing: () => import('@baseworks/module-billing'),
};

export interface RegistryConfig {
  role: "api" | "worker" | "all";
  modules: string[];
}

/**
 * Config-driven module registry. Loads modules listed in config,
 * registers their commands/queries into the CQRS bus, and attaches routes.
 */
export class ModuleRegistry {
  private loaded = new Map<string, ModuleDefinition>();
  private cqrs: CqrsBus;
  private eventBus: TypedEventBus;
  private config: RegistryConfig;

  constructor(config: RegistryConfig) {
    this.config = config;
    this.cqrs = new CqrsBus();
    this.eventBus = new TypedEventBus();
  }

  async loadAll(): Promise<void> {
    for (const name of this.config.modules) {
      const importFn = moduleImportMap[name];
      if (!importFn) {
        logger.error({ module: name }, "Module not found in import map -- skipping");
        continue;
      }

      try {
        const mod = await importFn();
        const def: ModuleDefinition = mod.default ?? mod;

        if (def.name !== name) {
          logger.warn(
            { expected: name, actual: def.name },
            "Module name mismatch between config and definition",
          );
        }

        // Register commands
        for (const [key, handler] of Object.entries(def.commands ?? {})) {
          this.cqrs.registerCommand(key, handler);
        }

        // Register queries
        for (const [key, handler] of Object.entries(def.queries ?? {})) {
          this.cqrs.registerQuery(key, handler);
        }

        this.loaded.set(name, def);
        logger.info({ module: name }, "Module loaded");
      } catch (error) {
        logger.error({ module: name, error }, "Failed to load module");
        throw error;
      }
    }

    logger.info(
      { count: this.loaded.size, modules: [...this.loaded.keys()] },
      "Module registry initialized",
    );
  }

  attachRoutes(app: Elysia<any>): void {
    if (this.config.role === "worker") {
      logger.info("Worker role -- skipping route attachment");
      return;
    }

    for (const [name, def] of this.loaded) {
      if (def.routes) {
        app.use(def.routes as any);
        logger.info({ module: name }, "Routes attached");
      }
    }
  }

  getCqrs(): CqrsBus {
    return this.cqrs;
  }

  getEventBus(): TypedEventBus {
    return this.eventBus;
  }

  getLoaded(): Map<string, ModuleDefinition> {
    return this.loaded;
  }

  getLoadedNames(): string[] {
    return [...this.loaded.keys()];
  }
}
