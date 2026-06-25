import type { ModuleDefinition } from "@baseworks/shared";
import { fileRelationsRegistry } from "@baseworks/storage";
import { Elysia } from "elysia";
import { logger } from "../lib/logger";
import { CqrsBus } from "./cqrs";
import { TypedEventBus } from "./event-bus";
import { HealthAggregator } from "./health-aggregator";

/**
 * Static import map for modules. Ensures imports are statically analyzable by Bun.
 * Future modules are added here -- no arbitrary string-based dynamic imports.
 */
const moduleImportMap: Record<string, () => Promise<any>> = {
  example: () => import("@baseworks/module-example"),
  auth: () => import("@baseworks/module-auth"),
  billing: () => import("@baseworks/module-billing"),
  files: () => import("@baseworks/module-files"),
  notifications: () => import("@baseworks/module-notifications"),
  // Future modules added here:
};

export interface RegistryConfig {
  role: "api" | "worker" | "all";
  modules: string[];
}

/**
 * Issue #3 — assert a module's declared BullMQ queue names are valid before any
 * `Queue`/`Worker` handle is constructed. BullMQ 5 forbids `:` in queue names (it
 * is the Redis key separator) and `new Queue(name)` throws the opaque "Queue name
 * cannot contain :" only later, in whichever process (api or worker) first builds
 * the handle. Validating at registration points at the offending module + job with
 * a fix hint. Pure + exported so it is unit-testable without the static import map.
 *
 * @throws If any job's `queue` contains `:`.
 */
export function assertValidQueueNames(moduleName: string, jobs: ModuleDefinition["jobs"]): void {
  for (const [jobName, jobDef] of Object.entries(jobs ?? {})) {
    if (jobDef.queue.includes(":")) {
      throw new Error(
        `Module "${moduleName}" job "${jobName}" declares queue "${jobDef.queue}", which contains ":". ` +
          "BullMQ forbids ':' in queue names (it is the Redis key separator). Use hyphens instead " +
          `(e.g. "${jobDef.queue.replace(/:/g, "-")}").`,
      );
    }
  }
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
  private healthAggregator: HealthAggregator;
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
    // Phase 22 / OPS-04 — central health aggregator owned by the registry.
    this.healthAggregator = new HealthAggregator();
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
      // A module configured more than once loads only once; this dedupe means
      // the duplicate-key guard below fires only for genuinely DISTINCT modules
      // that collide on the same namespaced CQRS key.
      if (this.loaded.has(name)) {
        logger.warn({ module: name }, "Module already loaded -- skipping duplicate config entry");
        continue;
      }

      const importFn = moduleImportMap[name];
      if (!importFn) {
        logger.error({ module: name }, "Module not found in import map");
        throw new Error(
          `Module "${name}" is configured but has no entry in the static import map. ` +
            `Add it to moduleImportMap in apps/api/src/core/registry.ts or remove it from the module config.`,
        );
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

        // Register commands. Throw on a duplicate key so two modules shipping
        // the same namespaced handler fail boot loudly instead of one silently
        // overwriting the other (cqrs-silent-handler-overwrite).
        for (const [key, handler] of Object.entries(def.commands ?? {})) {
          if (this.cqrs.hasCommand(key)) {
            throw new Error(
              `Duplicate command key "${key}" registered by module "${name}". ` +
                "Two modules cannot register the same namespaced CQRS command.",
            );
          }
          this.cqrs.registerCommand(key, handler);
        }

        // Register queries (same duplicate-key guard as commands).
        for (const [key, handler] of Object.entries(def.queries ?? {})) {
          if (this.cqrs.hasQuery(key)) {
            throw new Error(
              `Duplicate query key "${key}" registered by module "${name}". ` +
                "Two modules cannot register the same namespaced CQRS query.",
            );
          }
          this.cqrs.registerQuery(key, handler);
        }

        // Register health contributor (Phase 22 / OPS-04 / D-10)
        if (def.health) {
          this.healthAggregator.register(def.health);
        }

        // Register file-relations (Phase 24 / FILE-01 / MOD-01 / D-09).
        // Each module's `fileRelations: Record<kind, FileRelation>` is collected
        // into the process-wide fileRelationsRegistry. Phase 26's files-module
        // sign-upload contract reads from this populated registry.
        // Zod validation in register() throws with module + kind context on
        // invalid shape — fails boot loud per D-07.
        if (def.fileRelations) {
          for (const [kind, relation] of Object.entries(def.fileRelations)) {
            fileRelationsRegistry.register(name, kind, relation);
          }
        }

        // Issue #3 — fail boot loud (in BOTH the api and worker roles) if a module
        // declares a BullMQ queue name containing `:`, before any handle is built.
        assertValidQueueNames(name, def.jobs);

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
   * Returns a single Elysia plugin that chains all non-auth, non-billing module routes.
   * Used in the app composition chain to preserve type inference for Eden Treaty.
   */
  getModuleRoutes() {
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

  /** Returns the HealthAggregator instance (Phase 22 / OPS-04). Same instance across calls. */
  getHealthAggregator(): HealthAggregator {
    return this.healthAggregator;
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
