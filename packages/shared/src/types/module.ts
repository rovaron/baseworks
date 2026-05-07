import type { CommandHandler, QueryHandler } from "./cqrs";

/**
 * Defines a background job that a module registers for BullMQ processing.
 *
 * Each job specifies a named queue and an async handler function. The module
 * registry registers these with the worker entrypoint, which creates BullMQ
 * Worker instances for each queue.
 */
export interface JobDefinition {
  /** BullMQ queue name, conventionally `module:action` (e.g., `email-send`). */
  queue: string;
  /** Async function that processes the job payload. */
  handler: (data: unknown) => Promise<void>;
}

/**
 * Contract that all Baseworks modules must satisfy.
 *
 * Declares routes, commands, queries, jobs, and events that the module
 * provides. The ModuleRegistry loads modules listed in config and wires
 * their declarations into the CQRS bus, event bus, and Elysia route tree.
 *
 * The `routes` function receives an Elysia app instance. The type is left
 * generic here to avoid a runtime dependency on Elysia in the shared package.
 * Modules that implement routes will import Elysia in their own package.
 */
export interface ModuleDefinition {
  /** Unique module identifier used for CQRS command/query namespacing. */
  name: string;
  /** Elysia plugin factory or plugin instance providing HTTP routes. */
  routes?: ((app: any) => any) | any;
  /** Map of command names to validated CommandHandler functions. */
  commands?: Record<string, CommandHandler<any, any>>;
  /** Map of query names to validated QueryHandler functions. */
  queries?: Record<string, QueryHandler<any, any>>;
  /** Map of job names to JobDefinition for BullMQ worker registration. */
  jobs?: Record<string, JobDefinition>;
  /** List of domain event names this module may emit. */
  events?: string[];
  /** Optional health contributor — registered into the central HealthAggregator at loadAll() (Phase 22 / OPS-04). */
  health?: HealthContributor;
}

/**
 * Phase 22 / OPS-04 / D-10 — outcome of a single module's health probe.
 * Aggregator combines all results via worst-of-N rollup.
 */
export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  details?: Record<string, unknown>;
}

/**
 * Phase 22 / OPS-04 / D-10 — module-supplied health contributor.
 * Registered into the central HealthAggregator at `registry.loadAll()` time.
 */
export interface HealthContributor {
  /** Typically the module name; required so the aggregator can label results. */
  name: string;
  /** Async probe; returned status feeds the worst-of-N rollup. */
  check: () => Promise<HealthCheckResult>;
  /** Per-contributor timeout in ms; defaults to 2000ms in the aggregator (D-11). */
  timeoutMs?: number;
}

/**
 * Phase 24 / FILE-01 — canonical declaration of an image-variant spec.
 *
 * `ImageVariantSpec` lives in `@baseworks/shared` (per PATTERNS lines 760-762
 * + Plan 24-01 type-ownership decision): the type has zero workspace deps and
 * is safe to import from any package; `ModuleDefinition` is the contract owner
 * and lives in shared. `@baseworks/storage` import-and-re-exports the type so
 * downstream code can `import { ImageVariantSpec } from "@baseworks/storage"`
 * without changing its import path.
 *
 * T-24-01-02 mitigation: the `format` union restricts variants to web-safe
 * raster formats — SVG is structurally rejected at compile time (Pitfall 10 /
 * IDA-02 — XSS via `<script>` in SVG variant outputs).
 *
 * (Declared here in Plan 24-01 to satisfy the soft cross-plan dependency on
 * Plan 24-03; Plan 24-03 confirms / extends as needed.)
 */
export interface ImageVariantSpec {
  /** Variant identifier — used as the storage-key segment (e.g., "thumb-256"). */
  name: string;
  /** Target width in pixels. */
  width: number;
  /** Optional target height; if omitted, aspect ratio is preserved. */
  height?: number;
  /** Output format. SVG intentionally excluded (T-24-01-02). */
  format: "webp" | "jpeg" | "png";
  /** Quality 1-100 (adapter-specific default if omitted). */
  quality?: number;
}
