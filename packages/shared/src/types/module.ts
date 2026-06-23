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
  /**
   * Phase 28 / IMG-01 — optional BullMQ worker concurrency for this job's queue.
   * The worker loop passes it to `createWorker` as `{ concurrency }`. When
   * omitted the shared default (5) applies. The image-transform job declares 2
   * to cap memory (each variant decodes a full image buffer in the worker).
   */
  concurrency?: number;
  /**
   * Phase 31 / OPS-02 — optional repeatable (cron) schedule for this job. When
   * set, the worker boot loop registers it on the SAME queue via BullMQ
   * `queue.upsertJobScheduler(jobName, { pattern }, { name, data: {} })`
   * (idempotent by `schedulerId === jobName`, so redeploys never duplicate
   * schedules). `pattern` is a standard 5-field cron string (cron-parser syntax,
   * e.g. `"0 * * * *"` = top of every hour). Jobs without `repeat` are consumer-
   * only and untouched (backward-compatible). Registration runs in the worker
   * role only and is guarded so a scheduler failure never aborts consumer boot.
   */
  repeat?: { pattern: string };
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
  /** Optional polymorphic file-relations declaration (Phase 24 / FILE-01 / MOD-01 / D-06). Collected into fileRelationsRegistry at loadAll() per D-09. Keyed by `kind`; `kind` is the registry-side discriminator. */
  fileRelations?: Record<string, FileRelation>;
}

/**
 * Phase 24 / FILE-01 / D-06 — declares a single polymorphic file relation on
 * a module. Collected at boot into `fileRelationsRegistry` (Plan 24-05) keyed
 * by `(ownerModule, kind)` per D-08, where `kind` is the Record key in
 * `ModuleDefinition.fileRelations`.
 *
 * `recordType` is the schema-side discriminator (matches `files.owner_record_type`).
 * Phases 26-29 use this for sign-upload validation, attach-file routing, and
 * cascade-on-delete.
 *
 * Hooks `canRead`/`canWrite` receive the request `HandlerContext` (typed `any`
 * here to avoid a cqrs.ts cycle in shared). Phase 26 docs the expected shape
 * in `packages/modules/files/` consumer code.
 */
export interface FileRelation {
  /** Discriminator stored in `files.owner_record_type`. */
  recordType: string;
  /** Allowed MIME types for sign-upload validation (Phase 26 enforcement). */
  allowedMimeTypes: string[];
  /** Max bytes per file; sign-upload denies anything larger (Phase 26 enforcement). */
  maxByteSize: number;
  /** Optional variants generated asynchronously by Phase 28 sharp/imagescript adapter. */
  generateVariants?: ImageVariantSpec[];
  /** Cascade strategy when the owning record is deleted (Phase 27 / MOD-03). */
  onDelete?: "cascade" | "orphan";
  /**
   * Phase 29 / IDA-01 — relation cardinality per owner record. `"single"`
   * (avatar/logo) makes `attach-file` cascade-soft-delete any prior live file
   * for the same `(tenant, ownerModule, recordType, ownerRecordId)` tuple
   * (latest-wins, refunding quota). `"many"` (default when omitted) keeps every
   * attached file. Backward-compatible: all existing relations omit it ⇒ many.
   */
  cardinality?: "single" | "many";
  /** Per-request read-permission hook (Phase 27 / ATT-02). Return false → 404 (no existence leak). */
  canRead?: (ctx: any, recordId: string) => Promise<boolean>;
  /** Per-request write-permission hook (Phase 26 sign-upload). Return false → 403. */
  canWrite?: (ctx: any, recordId: string) => Promise<boolean>;
  /**
   * Phase 31 / OPS-02 — orphan-reaper owner-existence resolver. The daily
   * `cleanup-reap-orphan-files` job deletes a file ONLY when this returns a
   * definitive `false` (owner row provably gone — query succeeded, zero rows).
   * Absent / `"unknown"` (query failed or indeterminate) / `true` (owner alive)
   * ⇒ SKIP (never delete). Each owning module reads its OWN tables via the shared
   * `@baseworks/db` schema (e.g. `SELECT 1 FROM "user" WHERE id = recordId`) —
   * NOT a cross-module package import. Memoized per `(ownerModule, recordType,
   * recordId)` within one reaper run.
   */
  ownerExists?: (args: { tenantId: string; recordId: string }) => Promise<boolean | "unknown">;
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
