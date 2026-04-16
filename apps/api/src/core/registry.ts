import type { ModuleDefinition } from "@baseworks/shared";
import { Elysia } from "elysia";
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
  billing: () => import("@baseworks/module-billing"),
  // Future modules added here:
};

export interface RegistryConfig {
  role: "api" | "worker" | "all";
  modules: string[];
}

/**
 * Config-driven module registry.
 *
 * Loads modules listed in {@link RegistryConfig}, registers their
 * commands and queries into the {@link CqrsBus}, and provides
 * route-mounting helpers for the Elysia app composition chain.
 * Each module is dynamically imported from the static import map
 * to maintain Bun analyzability.
 *
 * @example
 * const registry = new ModuleRegistry({ role: "api", modules: ["auth", "billing"] });
 * await registry.loadAll();
 * app.use(registry.getModuleRoutes());
 */
export class ModuleRegistry {
  private loaded = new Map<string, ModuleDefinition>();
  private cqrs: CqrsBus;
  private eventBus: TypedEventBus;
  private config: RegistryConfig;

  /**
   * Create a new registry with the given config.
   *
   * Instantiates internal CqrsBus and TypedEventBus. Modules are
   * not loaded until {@link loadAll} is called.
   *
   * @param config - Registry configuration specifying role and module list
   */
  constructor(config: RegistryConfig) {
    this.config = config;
    this.cqrs = new CqrsBus();
    this.eventBus = new TypedEventBus();
  }

  /**
   * Load all modules configured in the registry config.
   *
   * Imports each module from the static import map, registers its
   * commands and queries in the CqrsBus, and stores the loaded
   * ModuleDefinition. Throws on module load failure to prevent
   * partial initialization.
   *
   * @throws If any configured module fails to import
   */
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

  /**
   * Returns the auth module's routes plugin for mounting BEFORE tenant middleware.
   * Auth routes (signup, login, OAuth callbacks) must not require tenant context.
   */
  getAuthRoutes(): any {
    const authModule = this.loaded.get("auth");
    if (authModule?.routes) return authModule.routes;
    return null;
  }

  /**
   * Attach loaded module routes to the Elysia app instance.
   *
   * Must be called after {@link loadAll}. Skips auth and billing
   * modules (mounted separately for type chain preservation).
   * No-ops when running in worker role.
   *
   * @param app - Elysia app instance to mount routes on
   */
  attachRoutes(app: Elysia<any>): void {
    if (this.config.role === "worker") {
      logger.info("Worker role -- skipping route attachment");
      return;
    }

    for (const [name, def] of this.loaded) {
      // Auth routes are mounted separately before tenant middleware
      if (name === "auth") continue;
      // Billing routes are mounted explicitly in app chain for type inference
      if (name === "billing") continue;
      if (def.routes) {
        app.use(def.routes as any);
        logger.info({ module: name }, "Routes attached");
      }
    }
  }

  /**
   * Returns a single Elysia plugin that chains all non-auth, non-billing module routes.
   * Used in the app composition chain to preserve type inference for Eden Treaty.
   */
  getModuleRoutes(): Elysia<any> {
    const plugin = new Elysia({ name: "module-routes" });

    if (this.config.role === "worker") {
      logger.info("Worker role -- skipping route attachment");
      return plugin;
    }

    for (const [name, def] of this.loaded) {
      // Auth and billing routes are mounted separately for type chain preservation
      if (name === "auth" || name === "billing") continue;
      if (def.routes) {
        plugin.use(def.routes as any);
        logger.info({ module: name }, "Routes attached via getModuleRoutes");
      }
    }

    return plugin;
  }

  /** Returns the CqrsBus instance used by this registry. */
  getCqrs(): CqrsBus {
    return this.cqrs;
  }

  /** Returns the TypedEventBus instance used by this registry. */
  getEventBus(): TypedEventBus {
    return this.eventBus;
  }

  /** Returns the map of loaded ModuleDefinition objects keyed by name. */
  getLoaded(): Map<string, ModuleDefinition> {
    return this.loaded;
  }

  /** Returns the names of all loaded modules as a string array. */
  getLoadedNames(): string[] {
    return [...this.loaded.keys()];
  }
}
