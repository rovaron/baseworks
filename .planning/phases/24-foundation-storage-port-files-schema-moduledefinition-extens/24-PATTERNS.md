# Phase 24: Foundation — Storage Port + Files Schema + ModuleDefinition Extension - Pattern Map

**Mapped:** 2026-05-05
**Files analyzed:** 22 (15 NEW + 7 MODIFIED)
**Analogs found:** 22 / 22 (every new/modified file has a verified in-repo analog)

> **Note:** CONTEXT.md was the authoritative source. RESEARCH.md (`.planning/research/ARCHITECTURE.md` §11, SUMMARY.md §4) provided the new-vs-modified inventory. All analogs below were verified by reading the live source files; line numbers cited are from the current `main` branch.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/storage/src/ports/file-storage.ts` | port | request-response | `packages/observability/src/ports/tracer.ts` | exact |
| `packages/storage/src/ports/image-transform.ts` | port | transform | `packages/observability/src/ports/tracer.ts` | role-match |
| `packages/storage/src/adapters/local/file-storage.ts` | adapter (scaffold) | request-response | `packages/observability/src/adapters/noop/noop-tracer.ts` | role-match |
| `packages/storage/src/adapters/s3/file-storage.ts` | adapter (scaffold) | request-response | `packages/observability/src/adapters/noop/noop-tracer.ts` | role-match |
| `packages/storage/src/adapters/s3-compat/file-storage.ts` | adapter (scaffold) | request-response | `packages/observability/src/adapters/noop/noop-tracer.ts` | role-match |
| `packages/storage/src/adapters/sharp/image-transform.ts` | adapter (scaffold) | transform | `packages/observability/src/adapters/noop/noop-tracer.ts` | role-match |
| `packages/storage/src/adapters/imagescript/image-transform.ts` | adapter (scaffold) | transform | `packages/observability/src/adapters/noop/noop-tracer.ts` | role-match |
| `packages/storage/src/factory.ts` | factory | env-driven singleton | `packages/observability/src/factory.ts` | exact |
| `packages/storage/src/env.ts` (`validateStorageEnv`) | env-validator | boot-time validation | `packages/config/src/env.ts` `validateObservabilityEnv` (lines 122-185) | exact |
| `packages/storage/src/registry.ts` (`fileRelationsRegistry`) | registry | collection | `packages/observability/src/health/heartbeat.ts` + `apps/api/src/core/health-aggregator.ts` | role-match |
| `packages/storage/src/index.ts` | barrel-export | n/a | `packages/observability/src/index.ts` | exact |
| `packages/storage/package.json` | config | n/a | `packages/observability/package.json` | exact |
| `packages/storage/tsconfig.json` | config | n/a | `packages/observability/tsconfig.json` | exact |
| `packages/db/src/schema/storage.ts` | schema | CRUD | `packages/db/src/schema/billing.ts` | exact |
| `packages/db/migrations/0002_v14_file_storage.sql` | migration | DDL | `packages/db/migrations/0000_red_lester.sql` | role-match (single existing migration) |
| `.biome/grit/ban-files-table-access.grit` (or `.biome/plugins/...`) | lint-rule | static-analysis | `.biome/plugins/no-als-enter-with.grit` | exact |
| `packages/shared/src/types/module.ts` (MOD: add `fileRelations?`) | type-definition | interface-extension | `packages/shared/src/types/module.ts` (existing `health?: HealthContributor`) | self-precedent |
| `apps/api/src/core/registry.ts` (MOD: collect fileRelations) | registry-extension | event-driven (boot) | `apps/api/src/core/registry.ts:101-103` (existing health-collection block) | exact (same file, same loop) |
| `packages/db/src/schema/index.ts` (MOD: re-export storage) | barrel-export | n/a | `packages/db/src/schema/index.ts` lines 3-4 (existing `auth`/`billing` re-exports) | self-precedent |
| `apps/api/src/index.ts` (MOD: call `validateStorageEnv()`) | boot-wiring | event-driven | `apps/api/src/index.ts:51-53` (existing `validatePaymentProviderEnv()` + `validateObservabilityEnv()` calls) | exact |
| `apps/api/src/worker.ts` (MOD: call `validateStorageEnv()`) | boot-wiring | event-driven | `apps/api/src/worker.ts:25-27` (existing validators) | exact |
| `biome.json` (MOD: add plugin entry) | config | n/a | `biome.json` (existing single-entry `plugins` array) | self-precedent |
| `.env.example` (MOD: add storage vars) | doc/config | n/a | `.env.example` (existing payment + observability blocks) | self-precedent |

---

## Pattern Assignments

### `packages/storage/src/ports/file-storage.ts` (port, request-response)

**Analog:** `packages/observability/src/ports/tracer.ts`

**Header doc + design-rule pattern** (lines 1-15 of analog):
```ts
/**
 * Tracer port interface (OBS-03).
 *
 * Contract for distributed-tracing adapters. Phase 17 ships NoopTracer;
 * Phase 21 adds OtelTracer backed by @opentelemetry/api.
 *
 * Design decisions:
 * - `startSpan` returns a Span object (never null) so call sites never branch.
 * - `withSpan` is the preferred API for scoped spans — handles end() in finally.
 * ...
 */
```
Storage port mirrors: header cites Phase 24 / FILE-01, lists adapters arriving in Phase 25, lists design decisions (e.g., "every method returns a typed result, never null" — matches D-15 throwing-NotImplemented invariant).

**Interface shape pattern** (lines 73-124 of analog):
```ts
export interface Tracer {
  /** Adapter identifier (e.g., `"noop"`, `"otel"`). */
  readonly name: string;

  startSpan(name: string, options?: SpanOptions): Span;
  withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, options?: SpanOptions): Promise<T>;
  inject(carrier: TraceCarrier): void;
  extract(carrier: TraceCarrier): void;
  currentCarrier(): TraceCarrier;
}
```
**Apply to FileStorage:**
- `readonly name: string` is mandatory (`'local' | 's3' | 's3-compat'`).
- All async methods return `Promise<...>`. Method shapes from RESEARCH §3: `signUpload`, `signRead`, `stat`, `delete`, `getObject`, `putObject`.
- Supporting interfaces (`SignedUpload`, `SignedRead`, `ObjectStat`) live in same file or split into `ports/types.ts` (precedent: `packages/observability/src/ports/types.ts`).

**Re-export pattern at bottom** (line 127 of analog):
```ts
export type { Attributes, TraceCarrier } from "./types";
```

---

### `packages/storage/src/ports/image-transform.ts` (port, transform)

**Analog:** Same — `packages/observability/src/ports/tracer.ts`.

Same header + interface pattern. Single method `resize(args: { input: Uint8Array; ... }): Promise<{ output: Uint8Array; ... }>` per RESEARCH §3. `readonly name: string` mandatory.

---

### `packages/storage/src/adapters/{local,s3,s3-compat}/file-storage.ts` (adapter scaffolds)

**Analog:** `packages/observability/src/adapters/noop/noop-tracer.ts`

**Design-rule comment + class shape** (lines 1-23 of analog):
```ts
/**
 * Noop Tracer adapter (OBS-03).
 *
 * Default adapter when `TRACER` is unset or `=noop`. Zero external traffic,
 * zero allocation beyond the per-call `NoopSpan` ...
 *
 * Design rule: NEVER throws on any input. ...
 */

import type { Span, SpanOptions, Tracer } from "../../ports/tracer";
import type { TraceCarrier } from "../../ports/types";

class NoopSpan implements Span {
  end(): void {}
  ...
}

export class NoopTracer implements Tracer {
  readonly name = "noop";

  startSpan(_name: string, _options?: SpanOptions): Span {
    return new NoopSpan();
  }
  ...
}
```

**Adapt for Phase 24 throwing-NotImplemented (D-15):**
```ts
/**
 * LocalFileStorage adapter (FILE-01).
 *
 * Phase 24 scaffold: every method throws with a phase-pointer message.
 * Real implementation arrives in Phase 25 (Plan 25-XX).
 *
 * Design rule: factory.getFileStorage() returns a real instance — never null —
 * so the contract surface is verifiable in Phase 24 even before bodies exist.
 */
import type { FileStorage, SignedUpload /* ... */ } from "../../ports/file-storage";

export class LocalFileStorage implements FileStorage {
  readonly name = "local";

  async signUpload(_args: { /* ... */ }): Promise<SignedUpload> {
    throw new Error(
      "FileStorage.signUpload: not yet implemented in Phase 24; arriving in Phase 25 (LocalFileStorage adapter).",
    );
  }
  // ... same shape for signRead, stat, delete, getObject, putObject
}
```
- Constructor argument shape varies per provider; LocalFileStorage takes nothing (or `{ root }` in Phase 25). S3FileStorage / S3CompatFileStorage take an `{ kind: 'aws' | 's3-compat', endpoint?, forcePathStyle?, ... }` config per RESEARCH §3 D-05.
- File naming: directory uses adapter slug (`local/`, `s3/`, `s3-compat/`); file inside is short (`file-storage.ts`). RESEARCH §3 layout shows `local/local-file-storage.ts` — Phase 24 CONTEXT explicitly lists `adapters/local/file-storage.ts` (the simpler form). Use the simpler form per CONTEXT.

---

### `packages/storage/src/adapters/{sharp,imagescript}/image-transform.ts` (adapter scaffolds)

**Analog:** Same — `packages/observability/src/adapters/noop/noop-tracer.ts`. Same pattern as above. Single `resize` method throws with `"ImageTransform.resize: not yet implemented in Phase 24; arriving in Phase 28 ({Sharp|Imagescript}ImageTransform adapter)."`. Per D-16.

---

### `packages/storage/src/factory.ts` (factory, env-driven singleton)

**Analog:** `packages/observability/src/factory.ts` — verbatim copy.

**Header comment** (lines 1-15 of analog):
```ts
/**
 * Observability port singleton factories (OBS-01, OBS-02, OBS-03).
 *
 * Three lazy-singleton factories — one per port — selected by env var:
 *   - TRACER           → getTracer()         default "noop"
 * ...
 *
 * IMPORTANT: This file reads `process.env` directly. It does NOT import
 * `@baseworks/config` so it can be safely loaded by `apps/api/src/telemetry.ts`
 * (which obeys D-06 — no @baseworks/config import before sdk.start()).
 */
```
**Apply to storage** (CONTEXT D-15/D-16): two factories `getFileStorage()` and `getImageTransform()`. Header cites Phase 24 / FILE-01 + the same `process.env` invariant. (RESEARCH note in CONTEXT line 105: "no `@baseworks/config` import to keep telemetry-bootstrap-safe" — same rule applies here for symmetry.)

**Imports + module-level singleton + getter/reset/set trio** (lines 16-78 of analog):
```ts
import type { Tracer } from "./ports/tracer";
import { NoopTracer } from "./adapters/noop/noop-tracer";

let tracerInstance: Tracer | null = null;

export function getTracer(): Tracer {
  if (!tracerInstance) {
    const name = process.env.TRACER ?? "noop";
    switch (name) {
      case "noop":
        tracerInstance = new NoopTracer();
        break;
      default:
        throw new Error(
          `Unknown TRACER: ${name}. Phase 17 supports only 'noop'.`,
        );
    }
  }
  return tracerInstance;
}

export function resetTracer(): void {
  tracerInstance = null;
}

export function setTracer(tracer: Tracer): void {
  tracerInstance = tracer;
}
```

**Mapping for Phase 24:**
- `getFileStorage()` reads `process.env.STORAGE_PROVIDER ?? "local"` (D-10 default). Switch arms: `'local'` → `new LocalFileStorage()`, `'s3'` → `new S3FileStorage({ kind: 'aws', ...readS3EnvBlock() })`, `'s3-compat'` → `new S3CompatFileStorage({ kind: 's3-compat', ...readS3EnvBlock() })`. Default arm throws `Unknown STORAGE_PROVIDER: ${name}. Supported: local, s3, s3-compat.`
- `getImageTransform()` reads `process.env.IMAGE_TRANSFORM_PROVIDER ?? "sharp"` (D-12). Switch arms: `'sharp'` → `new SharpImageTransform()`, `'imagescript'` → `new ImagescriptImageTransform()`. Same default-throw shape.
- `set*` / `reset*` ship for both per CONTEXT line 105 ("`set*`/`reset*` test helpers").
- Adapter-specific env reads happen INSIDE the case arm (matches sentry/glitchtip arms at lines 175-204 of analog: `const dsn = process.env.SENTRY_DSN; if (!dsn) throw ...`). This keeps `validateStorageEnv()` (env.ts) and `getFileStorage()` defending the same invariant from two angles.

---

### `packages/storage/src/env.ts` — `validateStorageEnv()` (env-validator, boot-time)

**Analog:** `packages/config/src/env.ts` `validateObservabilityEnv()` — lines 107-185 — verbatim structural copy.

**Header doc pattern** (lines 107-121 of analog):
```ts
/**
 * Validate that the required observability secrets are present for the
 * currently-selected adapter. Must be called at startup (after `sdk.start()`
 * per D-06) to prevent runtime crashes on first observability operation.
 * ...
 * Mirrors validatePaymentProviderEnv() — same crash-hard discipline, same
 * per-adapter switch shape (D-08, D-09).
 *
 * @throws Error if a selected adapter is missing its required env keys
 */
```

**Body pattern** (lines 122-185 of analog):
```ts
export function validateObservabilityEnv(): void {
  const isTest = env.NODE_ENV === "test";

  switch (env.ERROR_TRACKER ?? "pino") {
    case "noop":
    case "pino":
      break;
    case "sentry":
      if (!env.SENTRY_DSN) {
        if (isTest) {
          console.warn("[env] WARNING: SENTRY_DSN is not set (NODE_ENV=test).");
        } else {
          throw new Error(
            "SENTRY_DSN is required when ERROR_TRACKER=sentry. " +
              "Set SENTRY_DSN in your environment.",
          );
        }
      }
      break;
    case "glitchtip":
      if (!env.GLITCHTIP_DSN) { /* same shape */ }
      break;
  }

  switch (env.TRACER ?? "noop") { case "noop": break; }
  switch (env.METRICS_PROVIDER ?? "noop") { case "noop": break; }
}
```

**Apply to storage (D-13 / D-14):**
- Function name: `validateStorageEnv()`. Throws `Error`. Same `isTest` early-relax pattern.
- **Switch on `STORAGE_PROVIDER` (default `"local"` — D-10):**
  - `case "local":` — require `STORAGE_LOCAL_PATH` (default `'./storage'` per D-13 means *no* throw if unset; the default fills it). **D-14 production crash:** `if (env.NODE_ENV === "production") throw new Error("Local storage adapter is not safe for production. Set STORAGE_PROVIDER=s3 or s3-compat.");`
  - `case "s3":` — require `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`. Each missing var throws with named `{var} is required when STORAGE_PROVIDER=s3.`
  - `case "s3-compat":` — require `S3_ENDPOINT`, creds, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`. Same pattern.
- **Switch on `IMAGE_TRANSFORM_PROVIDER` (default `"sharp"` — D-12):** noop body for both arms in Phase 24 (no required env). Phase 28 may add validation.
- **`STORAGE_DEFAULT_QUOTA_BYTES`:** validated by Zod schema in `packages/config/src/env.ts` (number, default `1073741824` per D-11). Not in this validator.

**Test analog:** `packages/config/src/__tests__/validate-observability-env.test.ts` lines 1-80 — **subprocess pattern** because @t3-oss/env-core evaluates schema at module-import. Phase 24's tests for `validateStorageEnv()` MUST use the same `Bun.spawn(["bun", "-e", ...], { env: { ... } })` shape. Lines 26-47 are the canonical positive-path subprocess test.

---

### `packages/storage/src/registry.ts` — `fileRelationsRegistry` + `collectFileRelations()`

**Analog:** `apps/api/src/core/registry.ts` lines 100-103 (consumer side) + `packages/observability/src/health/heartbeat.ts` (singleton-with-handle pattern).

**Consumer-side analog excerpt** (`apps/api/src/core/registry.ts` lines 100-103):
```ts
        // Register health contributor (Phase 22 / OPS-04 / D-10)
        if (def.health) {
          this.healthAggregator.register(def.health);
        }
```

**`fileRelationsRegistry` design** (D-06, D-07, D-08):
```ts
import { z } from "zod";
import type { ModuleDefinition } from "@baseworks/shared";

export interface FileRelation {
  recordType: string;
  allowedMimeTypes: string[];
  maxByteSize: number;
  generateVariants?: ImageVariantSpec[];
  onDelete?: "cascade" | "orphan";
  canRead?: (ctx: any /* HandlerContext */, recordId: string) => Promise<boolean>;
  canWrite?: (ctx: any, recordId: string) => Promise<boolean>;
}

const fileRelationSchema = z.object({
  recordType: z.string().min(1),
  allowedMimeTypes: z.array(z.string().min(1)).nonempty(),
  maxByteSize: z.number().int().positive(),
  generateVariants: z.array(/* ImageVariantSpec */).optional(),
  onDelete: z.enum(["cascade", "orphan"]).optional(),
  canRead: z.function().optional(),
  canWrite: z.function().optional(),
});

class FileRelationsRegistry {
  private byKey = new Map<string, FileRelation>(); // key = `${ownerModule}:${kind}`

  register(ownerModule: string, kind: string, relation: FileRelation): void {
    const parsed = fileRelationSchema.safeParse(relation);
    if (!parsed.success) {
      throw new Error(
        `Invalid FileRelation for module="${ownerModule}" kind="${kind}": ${parsed.error.message}`,
      );
    }
    this.byKey.set(`${ownerModule}:${kind}`, parsed.data as FileRelation);
  }

  get(ownerModule: string, kind: string): FileRelation | undefined {
    return this.byKey.get(`${ownerModule}:${kind}`);
  }

  getAll(): ReadonlyMap<string, FileRelation> { return this.byKey; }
  reset(): void { this.byKey.clear(); }
}

export const fileRelationsRegistry = new FileRelationsRegistry();

/** Collected by ModuleRegistry.loadAll() per D-09. */
export function collectFileRelations(modules: Iterable<[string, ModuleDefinition]>): void {
  for (const [moduleName, def] of modules) {
    if (!def.fileRelations) continue;
    for (const [kind, relation] of Object.entries(def.fileRelations)) {
      fileRelationsRegistry.register(moduleName, kind, relation);
    }
  }
}
```
- **Singleton + `reset()` for tests** mirrors the factory pattern (`packages/observability/src/factory.ts:65 resetTracer`).
- **Throw-on-invalid-shape** matches D-07 ("fails boot loud").
- **Two-level keying `(ownerModule, kind)`** matches D-08.

---

### `packages/storage/src/index.ts` (barrel-export)

**Analog:** `packages/observability/src/index.ts` — lines 1-84.

**Pattern** (lines 1-33 of analog):
```ts
// @baseworks/observability — Phase 17 ports + noop adapters + env-selected factory.
// Barrel is populated incrementally by Phase 17 tasks. Plan 02 appends factory exports.
export type { Attributes, TraceCarrier, LogLevel } from "./ports/types";

export type { Tracer, Span, SpanOptions } from "./ports/tracer";
export { NoopTracer } from "./adapters/noop/noop-tracer";

// Env-selected singleton factories (Plan 17-02).
export {
  getTracer,
  setTracer,
  resetTracer,
  getMetrics,
  setMetrics,
  resetMetrics,
} from "./factory";
```

**Apply to storage:**
```ts
// @baseworks/storage — Phase 24 ports + scaffold adapters + env-selected factory.

// Ports (FILE-01, FILE-02).
export type { FileStorage, SignedUpload, SignedRead, ObjectStat } from "./ports/file-storage";
export type { ImageTransform, ImageVariantSpec } from "./ports/image-transform";

// Throwing-NotImplemented adapter scaffolds (Phase 24 / D-15 / D-16). Bodies in 25 / 28.
export { LocalFileStorage } from "./adapters/local/file-storage";
export { S3FileStorage } from "./adapters/s3/file-storage";
export { S3CompatFileStorage } from "./adapters/s3-compat/file-storage";
export { SharpImageTransform } from "./adapters/sharp/image-transform";
export { ImagescriptImageTransform } from "./adapters/imagescript/image-transform";

// Env-selected singleton factories.
export {
  getFileStorage,
  setFileStorage,
  resetFileStorage,
  getImageTransform,
  setImageTransform,
  resetImageTransform,
} from "./factory";

// Env validator (Phase 17 pattern; called from apps/api boot).
export { validateStorageEnv } from "./env";

// FileRelation registry + collector (D-06..D-09).
export type { FileRelation, ImageVariantSpec as VariantSpec } from "./ports/image-transform";
export {
  fileRelationsRegistry,
  collectFileRelations,
} from "./registry";
```

---

### `packages/storage/package.json` (config)

**Analog:** `packages/observability/package.json`.

**Pattern (verified excerpt):**
```json
{
  "name": "@baseworks/observability",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": { ... }
}
```
**Apply:** `name: "@baseworks/storage"`, `private: true`, `type: "module"`, `main`/`types` → `./src/index.ts`. Phase 24 dependencies: `zod` (registry validation), `@baseworks/shared` (workspace:*). NO `sharp`, `@aws-sdk/*`, or `Bun.S3Client` dep yet — those land in Phases 25 and 28.

---

### `packages/storage/tsconfig.json` (config)

**Analog:** `packages/observability/tsconfig.json`.

**Pattern (verified):**
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src/**/*.ts"]
}
```
Verbatim copy.

---

### `packages/db/src/schema/storage.ts` (schema, CRUD)

**Analog:** `packages/db/src/schema/billing.ts` (closest tenant-scoped multi-table feature schema; cited verbatim by CONTEXT line 89).

**Imports + table-comment pattern** (lines 1-23 of analog):
```ts
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";

/**
 * Billing module tables.
 *
 * Per D-02: billing_customers links tenants to payment provider customers.
 * Per D-07: webhook_events stores provider webhook events for idempotency and audit.
 * ...
 */
```

**Table-definition pattern** (lines 25-45 of analog):
```ts
export const billingCustomers = pgTable("billing_customers", {
  id: primaryKeyColumn(),
  tenantId: tenantIdColumn(),
  providerCustomerId: text("provider_customer_id").notNull().unique(),
  ...
  ...timestampColumns(),
});
```

**Multi-column index pattern** — `examples` table (`packages/db/src/schema/example.ts` lines 12-22):
```ts
export const examples = pgTable(
  "examples",
  { ... },
  (table) => [index("examples_tenant_id_idx").on(table.tenantId)],
);
```

**Apply to `storage.ts`:**
```ts
import {
  pgTable,
  text,
  bigint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";

/**
 * Storage module tables (Phase 24 / FILE-01).
 *
 * Central `files` table — single source of truth for all file metadata.
 * Modules declare polymorphic relations via ModuleDefinition.fileRelations
 * (D-06..D-09); they NEVER own per-module file tables.
 *
 * `tenant_storage_usage` — per-tenant byte counter, race-safe quota enforcement
 * lands in Phase 26's UPSERT pattern. `bytes_pending` ships in Phase 24 (D-02)
 * to avoid a Phase 26 column migration.
 */

export type FileTransform = {
  name: string; storageKey: string; mimeType: string; byteSize: number;
  width?: number; height?: number;
};

export const files = pgTable(
  "files",
  {
    id: primaryKeyColumn(),
    tenantId: tenantIdColumn(),
    ownerModule: text("owner_module").notNull(),
    ownerRecordType: text("owner_record_type").notNull(),
    ownerRecordId: text("owner_record_id").notNull(),
    storageKey: text("storage_key").notNull(),
    bucket: text("bucket").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    checksum: text("checksum"),
    originalFilename: text("original_filename"),
    transforms: jsonb("transforms").$type<FileTransform[]>().notNull().default([]),
    // D-01: full lifecycle declared in Phase 24; check constraint enforces it.
    status: text("status").notNull().default("pending"),
    uploadedByUserId: text("uploaded_by_user_id"), // text — references better-auth user.id
    deletedAt: timestamp("deleted_at"), // D-04: Phase 27 soft-delete consumer
    ...timestampColumns(),
  },
  (t) => [
    uniqueIndex("files_tenant_bucket_key_uq").on(t.tenantId, t.bucket, t.storageKey),
    index("files_owner_idx").on(t.tenantId, t.ownerModule, t.ownerRecordType, t.ownerRecordId),
    // D-04: partial index on live rows only — consumed Phase 27.
    index("files_pending_status_idx").on(t.status, t.createdAt),
  ],
);

export const tenantStorageUsage = pgTable("tenant_storage_usage", {
  tenantId: tenantIdColumn().primaryKey(),
  bytesUsed: bigint("bytes_used", { mode: "number" }).notNull().default(0),
  // D-02: ships Phase 24, consumer is Phase 26's race-safe UPSERT.
  bytesPending: bigint("bytes_pending", { mode: "number" }).notNull().default(0),
  bytesLimit: bigint("bytes_limit", { mode: "number" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

**Note:** RESEARCH §2 schema uses `(t) => ({ ... })` (object form) — but `examples` table uses `(table) => [...]` (array form). The array form is the current Drizzle 0.45+ idiom. Use array form.

**`status` CHECK constraint (D-01):** Drizzle 0.45 supports raw SQL CHECK via the table builder's third arg or the migration. Simpler approach: write the CHECK constraint directly into the migration SQL (see migration analog below) and keep the schema column declaration as plain `text("status").notNull().default("pending")`.

---

### `packages/db/migrations/0002_v14_file_storage.sql` (migration, DDL)

**Analog:** `packages/db/migrations/0000_red_lester.sql` (only existing migration; verified header pattern).

**Pattern (verbatim from analog):**
```sql
CREATE TABLE "examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"title" varchar(255) NOT NULL,
	...
);
--> statement-breakpoint
CREATE TABLE "account" (...
```

**Apply to `0002_v14_file_storage.sql` (D-05 — generated by `bun run db:generate`, then hand-edited to add CHECK + partial index):**
```sql
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar(36) NOT NULL,
	"owner_module" text NOT NULL,
	"owner_record_type" text NOT NULL,
	"owner_record_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"bucket" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"checksum" text,
	"original_filename" text,
	"transforms" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"status" text NOT NULL DEFAULT 'pending',
	"uploaded_by_user_id" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	-- D-01: full lifecycle declared up-front; Phases 26-28 transition into states.
	CONSTRAINT "files_status_check" CHECK ("status" IN ('pending', 'uploaded', 'transforming', 'ready', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "files_tenant_bucket_key_uq" ON "files" ("tenant_id", "bucket", "storage_key");
--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" ("tenant_id", "owner_module", "owner_record_type", "owner_record_id");
--> statement-breakpoint
-- D-04: partial index on live rows for pending-cleanup query in Phase 27.
CREATE INDEX "files_pending_status_idx" ON "files" ("status", "created_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "tenant_storage_usage" (
	"tenant_id" varchar(36) PRIMARY KEY NOT NULL,
	"bytes_used" bigint NOT NULL DEFAULT 0,
	"bytes_pending" bigint NOT NULL DEFAULT 0,
	"bytes_limit" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
```

**Filename collision check (Pitfall 22 from RESEARCH §13):** verify before commit that no `0002_*.sql` exists in `packages/db/migrations/` or in any `.claude/worktrees/agent-*` worktree. Currently only `0000_red_lester.sql` exists — `0001_*` is the next slot, `0002_*` would conflict if Phase 23 or another in-flight phase generates first. **Planner must check `packages/db/migrations/_journal.json`** before settling the number.

---

### `.biome/grit/ban-files-table-access.grit` (lint-rule)

**Analog:** `.biome/plugins/no-als-enter-with.grit` (verbatim structural copy).

**Important path note:** CONTEXT specifies `.biome/grit/ban-files-table-access.grit`. The repo currently keeps GritQL plugins under `.biome/plugins/` (single existing file). Planner should either (a) move the existing plugin into `.biome/grit/` and update `biome.json`, or (b) keep CONTEXT's stated `.biome/grit/` path and accept divergence, or (c) put the new rule in `.biome/plugins/ban-files-table-access.grit` (matches existing layout). **Recommendation: use `.biome/plugins/ban-files-table-access.grit` for layout consistency** — but flag this as a Claude's Discretion call (CONTEXT line 60-style choice, not locked).

**Header + rule shape pattern** (lines 1-24 of analog):
```ts
// Ban AsyncLocalStorage#enterWith per CTX-01 / Phase 19 (Plan 19-08 / D-24).
//
// Rule id (cited in the B5 red-path assertion): no-async-local-storage-enterWith
//
// Primary gate. Belt-and-suspenders via scripts/lint-no-enterwith.sh ...
//
// Reads are unaffected — `.getStore()`, `.exit(fn)`, and `.disable()` are all
// permitted. Only `.enterWith(` is banned.
//
// If a future exception arises, document it explicitly: add the file path to
// scripts/lint-no-enterwith.sh ALLOWLIST, add a biome-ignore comment here,
// AND justify in the commit message + SUMMARY.md.
`$obj.enterWith($args)` where {
  register_diagnostic(
    span = $obj,
    message = "AsyncLocalStorage.enterWith is banned (CTX-01). Use .run(store, fn) instead — see packages/observability/src/context.ts mutator helpers ... [no-async-local-storage-enterWith]",
    severity = "error"
  )
}
```

**Apply to ban-files-table-access (D-17):**
```grit
// Ban direct `db.select().from(files)` access outside packages/modules/files/
// per Phase 24 / D-17. Pitfall 5 (cross-tenant authz on file read).
//
// Rule id: no-direct-files-table-access
//
// Direct table access bypasses the files-module's permission/registry layer
// (FileRelation.canRead, polymorphic owner authorization, scopedDb tenant
// filter). The only sanctioned consumer is packages/modules/files/** (path
// created in Phase 26; allow-listed proactively here).
//
// Allowed reads: nothing — every files-table touch must go through the
// files module's CQRS commands/queries (sign-upload, get-signed-read-url,
// list-files-for-record).
//
// If a future exception arises, document it the same way as the
// no-als-enter-with allowlist precedent.
`$db.select($args).from(files)` where {
  // path-allowlist: packages/modules/files/**
  register_diagnostic(
    span = $db,
    message = "Direct `db.select().from(files)` is banned (Phase 24 / D-17). Use the files module's CQRS layer (sign-upload, get-signed-read-url, list-files-for-record). [no-direct-files-table-access]",
    severity = "error"
  )
}
```
**GritQL caveat:** the path-allowlist mechanism is not a built-in GritQL primitive — Biome's plugin loader applies the rule globally. Planner should check Biome 2.4+ docs for `where` `path` predicates; if absent, the allowlist is enforced in the rule by checking `$db` source path or supplemented by a path-aware shell script (`scripts/lint-no-direct-files-access.sh`) mirroring `scripts/lint-no-enterwith.sh` (referenced at lines 5-6 of analog).

---

### `packages/shared/src/types/module.ts` (MODIFIED — add `fileRelations?`)

**Analog:** Same file, existing `health?: HealthContributor` field (lines 41-43 + 56-66).

**Existing pattern** (lines 28-43 of `module.ts`):
```ts
export interface ModuleDefinition {
  name: string;
  routes?: ((app: any) => any) | any;
  commands?: Record<string, CommandHandler<any, any>>;
  queries?: Record<string, QueryHandler<any, any>>;
  jobs?: Record<string, JobDefinition>;
  events?: string[];
  /** Optional health contributor — registered into the central HealthAggregator at loadAll() (Phase 22 / OPS-04). */
  health?: HealthContributor;
}
```

**Apply (D-06, plus type definitions):**
```ts
export interface ModuleDefinition {
  // ... existing fields unchanged ...
  health?: HealthContributor;
  /** Optional polymorphic file-relations declaration (Phase 24 / FILE-01 / D-06). Collected into fileRelationsRegistry at loadAll(). */
  fileRelations?: Record<string, FileRelation>;
}

/**
 * Phase 24 / FILE-01 / D-06 — declares a single polymorphic file relation.
 * `recordType` is the schema-side discriminator; the registry key is
 * `(ownerModule, kind)` where kind is the enclosing Record's key.
 */
export interface FileRelation {
  recordType: string;
  allowedMimeTypes: string[];
  maxByteSize: number;
  generateVariants?: ImageVariantSpec[];
  onDelete?: "cascade" | "orphan";
  canRead?: (ctx: any /* HandlerContext from cqrs */, recordId: string) => Promise<boolean>;
  canWrite?: (ctx: any, recordId: string) => Promise<boolean>;
}

export interface ImageVariantSpec {
  name: string;
  width: number;
  height?: number;
  format: "webp" | "jpeg" | "png";
  quality?: number;
}
```

**Re-export** in `packages/shared/src/index.ts` adds:
```ts
export type {
  ModuleDefinition,
  JobDefinition,
  HealthContributor,
  HealthCheckResult,
  FileRelation,        // NEW
  ImageVariantSpec,    // NEW
} from "./types/module";
```

**Decision point for planner:** the `FileRelation` type is also asked for by `packages/storage/src/registry.ts`. Two options: (a) define it in `@baseworks/shared` and import from `@baseworks/storage` (no cycle — shared has no deps); (b) define it in `@baseworks/storage` and import from `@baseworks/shared`. Option (a) is preferred — `ModuleDefinition` is the contract owner, and shared has zero workspace deps so it's the safe sink. CONTEXT D-06 says storage owns the registry surface but does NOT mandate the type lives there.

---

### `apps/api/src/core/registry.ts` (MODIFIED — collect fileRelations after health)

**Analog:** Same file, lines 100-103 (the literal precedent cited in CONTEXT D-09).

**Existing block** (lines 90-105):
```ts
        // Register commands
        for (const [key, handler] of Object.entries(def.commands ?? {})) {
          this.cqrs.registerCommand(key, handler);
        }

        // Register queries
        for (const [key, handler] of Object.entries(def.queries ?? {})) {
          this.cqrs.registerQuery(key, handler);
        }

        // Register health contributor (Phase 22 / OPS-04 / D-10)
        if (def.health) {
          this.healthAggregator.register(def.health);
        }

        this.loaded.set(name, def);
```

**Apply (D-09 — immediately after health block):**
```ts
        // Register health contributor (Phase 22 / OPS-04 / D-10)
        if (def.health) {
          this.healthAggregator.register(def.health);
        }

        // Register file-relations (Phase 24 / FILE-01 / D-09)
        if (def.fileRelations) {
          for (const [kind, relation] of Object.entries(def.fileRelations)) {
            fileRelationsRegistry.register(name, kind, relation);
          }
        }

        this.loaded.set(name, def);
```

**Top-of-file imports add:**
```ts
import { fileRelationsRegistry } from "@baseworks/storage";
```

**D-18: do NOT add `'files'` to `moduleImportMap` (line 12-17).** Phase 26 adds it.

---

### `packages/db/src/schema/index.ts` (MODIFIED — re-export storage)

**Analog:** Same file, existing lines 3-4 (`auth`/`billing` re-exports).

**Existing pattern (verbatim):**
```ts
export { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";
export { examples } from "./example";
export * from "./auth";
export * from "./billing";
```

**Apply:**
```ts
export * from "./storage";
```
**Also propagate to `packages/db/src/index.ts`** following the billing precedent (lines 14-18):
```ts
export {
  files,
  tenantStorageUsage,
} from "./schema";
export type { FileTransform } from "./schema/storage";
```

---

### `apps/api/src/index.ts` (MODIFIED — call `validateStorageEnv()`)

**Analog:** Same file, lines 49-53.

**Existing pattern (verbatim excerpt):**
```ts
// Validate payment provider env vars at startup (T-10-09)
// Prevents starting with PAYMENT_PROVIDER=pagarme but no PAGARME_SECRET_KEY
validatePaymentProviderEnv();
// Phase 18 — crash-hard on missing DSN for the selected ERROR_TRACKER (D-09).
validateObservabilityEnv();
```

**Apply (insert after line 53):**
```ts
// Phase 24 — crash-hard on missing storage adapter env (D-13/D-14).
validateStorageEnv();
```

**Top-of-file import add:**
```ts
import { validateStorageEnv } from "@baseworks/storage";
```

---

### `apps/api/src/worker.ts` (MODIFIED — call `validateStorageEnv()`)

**Analog:** Same file, lines 25-27.

**Existing pattern (verbatim):**
```ts
validatePaymentProviderEnv();
// Phase 18 — crash-hard on missing DSN for the selected ERROR_TRACKER (D-09).
validateObservabilityEnv();
```

**Apply (insert after line 27):**
```ts
// Phase 24 — crash-hard on missing storage adapter env.
validateStorageEnv();
```

**(Note:** CONTEXT references `apps/worker/src/index.ts` but the actual repo has the worker at `apps/api/src/worker.ts`. Confirmed via `ls`. Planner must use the actual path.)

---

### `biome.json` (MODIFIED — add plugin entry)

**Analog:** Same file, current single-entry `plugins` array.

**Existing (verbatim):**
```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.10/schema.json",
  "plugins": ["./.biome/plugins/no-als-enter-with.grit"],
  ...
}
```

**Apply:**
```json
"plugins": [
  "./.biome/plugins/no-als-enter-with.grit",
  "./.biome/plugins/ban-files-table-access.grit"
],
```

---

### `.env.example` (MODIFIED — add storage block)

**Analog:** Same file, existing observability + payment blocks (around lines 15-30 + Phase 18 ERROR_TRACKER block).

**Existing pattern (verbatim, around line 36):**
```sh
# Payments (required for boot -- PAYMENT_PROVIDER defaults to "stripe").
# For local dev without real payments, any non-empty value satisfies
# validatePaymentProviderEnv(). Use a real sk_test_... key to exercise
# Stripe flows end-to-end. See packages/config/src/env.ts for the full
# validator.
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_dummy_replace_for_real_stripe_flows
```

**Apply (block-with-leading-comment pattern):**
```sh
# Phase 24 — File storage adapter (defaults to local for dev DX).
# Production deployments MUST set STORAGE_PROVIDER=s3 or s3-compat;
# validateStorageEnv() crashes at boot if STORAGE_PROVIDER=local && NODE_ENV=production
# (Pitfall 14 / D-14).
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./storage

# Phase 24 — Per-tenant storage quota in bytes (default 1 GiB / 1073741824).
# Per-tenant override available via tenant_storage_usage.bytes_limit row column (D-11).
STORAGE_DEFAULT_QUOTA_BYTES=1073741824

# Phase 24 — Image transform adapter (default sharp; Phase 28 may flip this
# if the Bun smoke test goes RED — D-12).
IMAGE_TRANSFORM_PROVIDER=sharp

# Phase 24 — S3 / S3-compatible adapter env (only required when
# STORAGE_PROVIDER=s3 or s3-compat). Bodies arrive in Phase 25.
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=us-east-1
# S3_BUCKET=
# S3_ENDPOINT=
# S3_FORCE_PATH_STYLE=true
```

---

## Shared Patterns

### Pattern: Header doc citing phase / decision IDs
**Source:** Every analog file uses the format `[Subject] ([D-XX]).` then "Phase 24 ships X; Phase Y adds Z." Examples: `factory.ts:1-15`, `tracer.ts:1-15`, `noop-tracer.ts:1-10`, `validateObservabilityEnv:107-121`.
**Apply to:** Every new file in this phase. Cite `Phase 24`, the relevant `D-XX` from CONTEXT, and what arrives in Phase 25/26/28.

### Pattern: Crash-hard env validation with subprocess tests
**Source:** `packages/config/src/env.ts:107-185` + `packages/config/src/__tests__/validate-observability-env.test.ts:1-80`.
**Apply to:** `validateStorageEnv()` in `packages/storage/src/env.ts`. Test file MUST use `Bun.spawn(["bun", "-e", "..."], { env: { ... }, cwd: import.meta.dir + "/..." })` shape because @t3-oss/env-core evaluates at module-import time.

### Pattern: Singleton + reset/set test helpers
**Source:** `packages/observability/src/factory.ts:30-78` (every factory exports `getX`/`setX`/`resetX`).
**Apply to:** `getFileStorage`/`setFileStorage`/`resetFileStorage` and `getImageTransform`/`setImageTransform`/`resetImageTransform`. Also `fileRelationsRegistry` exposes `reset()` for tests.

### Pattern: Drizzle table with shared base helpers
**Source:** `packages/db/src/schema/billing.ts:25-35` and `packages/db/src/schema/example.ts:12-22`.
**Apply to:** `files` and `tenant_storage_usage` tables. MANDATORY use of `primaryKeyColumn()`, `tenantIdColumn()`, `timestampColumns()` from `./base`.

### Pattern: Indexes via array form `(t) => [...]`
**Source:** `packages/db/src/schema/example.ts:21`.
**Apply to:** `files` table — array-of-indexes form, NOT object form (RESEARCH §2 uses object form, but the in-repo idiom is array form for current Drizzle 0.45+).

### Pattern: Boot-validator call ordering
**Source:** `apps/api/src/index.ts:46-53` and `apps/api/src/worker.ts:21-29`.
**Apply to:** `validateStorageEnv()` is called AFTER `validatePaymentProviderEnv()` and `validateObservabilityEnv()`, BEFORE `installGlobalErrorHandlers` and module registry creation.

### Pattern: Registry collected at `ModuleRegistry.loadAll()` after handler registration
**Source:** `apps/api/src/core/registry.ts:90-105`. Order: commands → queries → health → (NEW) fileRelations → loaded.set.
**Apply to:** D-09 — block lands immediately after the existing `def.health` block (lines 100-103).

### Pattern: Barrel export grouped by purpose with section comments
**Source:** `packages/observability/src/index.ts:1-84` — sections separated by blank lines + brief `// Phase X / Y` comments.
**Apply to:** `packages/storage/src/index.ts`.

### Pattern: GritQL plugin with rule-id, header doc, allowlist documentation
**Source:** `.biome/plugins/no-als-enter-with.grit:1-24`.
**Apply to:** `ban-files-table-access.grit` — same comment block listing rule-id, the pitfall, what is allowed, and the future-exception protocol.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every Phase 24 file has a strong in-repo analog. |

The only minor gap is the **DOWN migration** (D-05 says "Drizzle `down()` migration alongside the up"). The repo currently has only one migration (`0000_red_lester.sql`) and no observed `down` migration — Drizzle migrations don't auto-emit a down. Planner should treat this as a Claude's Discretion call (CONTEXT line 60-style): write a hand-crafted `0002_v14_file_storage_down.sql` companion file, or rely on `drizzle-kit drop`. No in-repo analog exists; document the choice in the plan.

---

## Metadata

**Analog search scope:**
- `packages/observability/src/` (factory, ports, adapters, index, package.json, tsconfig, tests)
- `packages/db/src/schema/` (billing, example, auth, base, index)
- `packages/db/migrations/` (only existing migration `0000_red_lester.sql`)
- `packages/db/src/index.ts` (re-export pattern)
- `packages/shared/src/types/module.ts` + `index.ts`
- `packages/config/src/env.ts` + `__tests__/validate-observability-env.test.ts`
- `apps/api/src/core/registry.ts`
- `apps/api/src/index.ts` + `apps/api/src/worker.ts` (boot wiring)
- `biome.json` + `.biome/plugins/no-als-enter-with.grit`
- `.env.example`

**Files read in full:** 14 (small files, ≤200 lines each — single read sufficed).
**Files read with offset/limit:** 2 (`apps/api/src/index.ts`, `apps/api/src/worker.ts` — only the boot prelude was relevant).

**Analogs verified to exist:** all 22 — every cited line number was read directly from the working tree.

**Pattern extraction date:** 2026-05-05
