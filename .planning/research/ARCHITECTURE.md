# ARCHITECTURE — v1.4 File Storage & Uploads

**Mode:** Project Research (subsequent milestone)
**Confidence:** HIGH (all integration points verified against live code)

---

## 1. Decision Summary

| Decision | Choice | Rationale |
|---|---|---|
| Where the port lives | **NEW workspace package `packages/storage/`** | Mirrors `packages/observability/` precedent. `FileStorage` + `ImageTransform` are cross-cutting infra, not domain. |
| Schema location | **`packages/db/src/schema/storage.ts`** (new file) | Same pattern as `auth.ts`/`billing.ts` — schemas live in `@baseworks/db`. |
| Module that owns the routes/CQRS/jobs | **NEW first-party module `packages/modules/files/`** | Routes (`/api/files/*`), commands (`sign-upload`, `complete-upload`, `delete-file`), queries (`get-signed-read-url`, `list-files`), jobs (`image-transform`, `cleanup-pending`), health contributor. |
| ID PK type | **`uuid` via `primaryKeyColumn()`** | Matches every tenant-owned table. Keeps ScopedDb compatible. |
| FKs to auth tables | **`text` (NOT uuid)** — `uploaded_by_user_id text`, `owner_record_id text` | `user.id` and `organization.id` are `text("id")` in better-auth schema. `tenant_id` stays `varchar(36)` via `tenantIdColumn()`. |
| Quota counter location | **Separate `tenant_storage_usage` table** | Org table is owned by better-auth; atomic increments cleanly tenant-scoped. |
| Adapter selection | **Singleton factory keyed by env** | Verbatim copy of `packages/modules/billing/src/provider-factory.ts` pattern. |
| Image transforms | **Async via BullMQ `image-transform` queue** | Off the upload response path. Sharp-under-Bun risk → port-and-adapter for `ImageTransform` lets us swap to imagescript/wasm-vips. |

---

## 2. Schema Design

**File:** `packages/db/src/schema/storage.ts` (NEW)

```ts
import { pgTable, text, bigint, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { primaryKeyColumn, tenantIdColumn, timestampColumns } from "./base";

export const files = pgTable("files", {
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
  transforms: jsonb("transforms").$type<FileTransform[]>().default([]).notNull(),
  status: text("status").notNull().default("pending"),
  uploadedByUserId: text("uploaded_by_user_id"),
  ...timestampColumns(),
}, (t) => ({
  storageKeyUq: uniqueIndex("files_tenant_bucket_key_uq").on(t.tenantId, t.bucket, t.storageKey),
  ownerIdx: index("files_owner_idx").on(t.tenantId, t.ownerModule, t.ownerRecordType, t.ownerRecordId),
  pendingIdx: index("files_pending_status_idx").on(t.status, t.createdAt),
}));

export type FileTransform = {
  name: string; storageKey: string; mimeType: string; byteSize: number;
  width?: number; height?: number;
};

export const tenantStorageUsage = pgTable("tenant_storage_usage", {
  tenantId: tenantIdColumn().primaryKey(),
  bytesUsed: bigint("bytes_used", { mode: "number" }).notNull().default(0),
  bytesLimit: bigint("bytes_limit", { mode: "number" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

**Schema notes:**
- `bigint` mode `"number"` safe to 2^53 bytes (~9 PB).
- `(tenantId, bucket, storageKey)` unique index prevents two records claiming the same object.
- `status` = plain text + Zod-enum at the port (avoids pg-enum migration coordination).
- Re-export from `packages/db/src/schema/index.ts` and `packages/db/src/index.ts`.

**Migration:** `bun run db:generate` → `packages/db/migrations/0002_v14_file_storage.sql` (verify number; worktrees may have collisions).

---

## 3. `FileStorage` + `ImageTransform` Ports

**Package:** `packages/storage/` (NEW workspace).

**Layout:**

```
packages/storage/
├── src/
│   ├── index.ts                      # barrel
│   ├── ports/
│   │   ├── file-storage.ts
│   │   ├── image-transform.ts
│   │   └── types.ts
│   ├── adapters/
│   │   ├── local/local-file-storage.ts
│   │   ├── s3/s3-file-storage.ts
│   │   ├── s3compat/s3compat-file-storage.ts
│   │   ├── sharp/sharp-image-transform.ts
│   │   └── imagescript/imagescript-image-transform.ts
│   ├── factory/
│   │   ├── file-storage.ts
│   │   └── image-transform.ts
│   └── lib/
│       ├── checksum.ts
│       └── key-builder.ts
```

**Port:**

```ts
export interface FileStorage {
  readonly name: string;
  signUpload(args: { bucket: string; key: string; mimeType: string; maxByteSize: number; expiresInSec: number }): Promise<SignedUpload>;
  signRead(args: { bucket: string; key: string; expiresInSec: number; responseContentDisposition?: string }): Promise<SignedRead>;
  stat(args: { bucket: string; key: string }): Promise<ObjectStat | null>;
  delete(args: { bucket: string; key: string }): Promise<void>;
  getObject(args: { bucket: string; key: string }): Promise<Uint8Array>;
  putObject(args: { bucket: string; key: string; body: Uint8Array; mimeType: string }): Promise<void>;
}

export interface SignedUpload {
  method: "PUT" | "POST"; url: string;
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  expiresAt: string;
}

export interface ImageTransform {
  readonly name: string;
  resize(args: { input: Uint8Array; width: number; height?: number; fit?: "cover"|"contain"|"inside"; format: "webp"|"jpeg"|"png"; quality?: number }): Promise<{ output: Uint8Array; mimeType: string; width: number; height: number }>;
}
```

**S3 + S3-compat split:** ~95% shared implementation. One class `S3FileStorage` accepting `{ kind: 'aws' | 's3-compat', endpoint?, forcePathStyle? }` (verbatim Phase 18 / D-05 `kind` tag pattern).

**Env additions** (`packages/config/src/env.ts`):

- `STORAGE_PROVIDER` = `'local' | 's3' | 's3-compat'` (default `'local'`)
- `STORAGE_LOCAL_ROOT` (when local)
- `STORAGE_S3_REGION` / `STORAGE_S3_BUCKET` / `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY`
- `STORAGE_S3_ENDPOINT` / `STORAGE_S3_FORCE_PATH_STYLE` (when s3-compat)
- `STORAGE_DEFAULT_QUOTA_BYTES` (default 5 GiB)
- `STORAGE_MAX_UPLOAD_BYTES` (default 100 MiB)
- `STORAGE_SIGNED_URL_TTL_SEC` (default 600)
- `IMAGE_TRANSFORM_PROVIDER` = `'sharp' | 'imagescript' | 'noop'` (default `'sharp'`)

---

## 4. Module Integration — `packages/modules/files/`

**Layout** (mirrors auth/billing/example):

```
packages/modules/files/src/
├── index.ts                # ModuleDefinition default export
├── routes.ts               # Elysia plugin: /api/files/*
├── schema.ts               # re-exports from @baseworks/db
├── commands/
│   ├── sign-upload.ts
│   ├── complete-upload.ts
│   └── delete-file.ts
├── queries/
│   ├── get-signed-read-url.ts
│   └── list-files-for-record.ts
├── jobs/
│   ├── image-transform.ts
│   └── cleanup-pending.ts
├── health/
│   └── storage.ts
└── lib/
    ├── relations-registry.ts
    ├── quota.ts
    ├── permission.ts
    └── key-naming.ts
```

**`ModuleDefinition` extension** in `packages/shared/src/types/module.ts`:

```ts
export interface FileRelation {
  recordType: string;
  allowedMimeTypes: string[];
  maxByteSize: number;
  generateVariants?: ImageVariantSpec[];
  onDelete?: "cascade" | "orphan";
  canRead?: (ctx: HandlerContext, recordId: string) => Promise<boolean>;
  canWrite?: (ctx: HandlerContext, recordId: string) => Promise<boolean>;
}

export interface ImageVariantSpec {
  name: string; width: number; height?: number;
  format: "webp" | "jpeg" | "png"; quality?: number;
}

export interface ModuleDefinition {
  // ...existing...
  fileRelations?: Record<string, FileRelation>;
}
```

**Registry collects relations at boot.** `apps/api/src/core/registry.ts:101-103` already iterates `def.health` — add an analogous block for `def.fileRelations` that pushes into `fileRelationsRegistry` (singleton in `@baseworks/module-files`).

**Auth module gains `fileRelations`** in `packages/modules/auth/src/index.ts`:

```ts
fileRelations: {
  user: {
    recordType: "user",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxByteSize: 5 * 1024 * 1024,
    generateVariants: [
      { name: "64",  width: 64,  format: "webp" },
      { name: "128", width: 128, format: "webp" },
      { name: "256", width: 256, format: "webp" },
      { name: "512", width: 512, format: "webp" },
    ],
    onDelete: "cascade",
    canWrite: async (ctx, userId) => ctx.userId === userId,
    canRead: async () => true,
  },
  organization: {
    recordType: "organization",
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    maxByteSize: 2 * 1024 * 1024,
    generateVariants: [
      { name: "128", width: 128, format: "webp" },
      { name: "256", width: 256, format: "webp" },
    ],
    onDelete: "orphan",
    canWrite: async (ctx, orgId) => ctx.tenantId === orgId,
  },
}
```

---

## 5. Upload Signing Flow (end-to-end)

1. **`POST /api/files/sign-upload`** — body `{ ownerModule, recordType, ownerRecordId, filename, mimeType, byteSize }`. Dispatches `files:sign-upload` CQRS command.

2. **`sign-upload` command:**
   - Validates input via `defineCommand(schema, ...)`.
   - Looks up `FileRelation` from `fileRelationsRegistry`. Returns `err("UNKNOWN_FILE_RELATION")` if missing.
   - Validates `mimeType ∈ allowedMimeTypes`, `byteSize ≤ maxByteSize`, `byteSize ≤ env.STORAGE_MAX_UPLOAD_BYTES`.
   - Calls `relation.canWrite(ctx, ownerRecordId)`; returns `err("FORBIDDEN")` on false.
   - **Quota check** — atomic `SELECT ... FOR UPDATE` on `tenant_storage_usage` inside `ctx.db.raw.transaction`.
   - Generates `storage_key = buildStorageKey(tenantId, ownerModule, recordType, ownerRecordId, ext)`.
   - Calls `getFileStorage().signUpload(...)`.
   - Inserts `files` row with `status='pending'`. Returns `{ fileId, signedUpload }`.

3. **Browser uploads directly to S3** (PUT or POST-form per adapter).

4. **`POST /api/files/:fileId/complete`** with `{ checksum }` → `files:complete-upload` command.
   - Loads file row by id (ScopedDb auto-filters by tenantId).
   - `getFileStorage().stat()` verifies `byteSize` matches stored value.
   - Single transaction: update `files.status='uploaded'` + `checksum`; `UPDATE tenant_storage_usage SET bytes_used = bytes_used + $1` (atomic).
   - If image relation has variants: `ctx.enqueue?.('image-transform', { fileId })` (Phase 20 wrapper auto-injects trace context).
   - Emits domain event `file.uploaded`.

5. **Cleanup job** — hourly BullMQ repeating job purges `status='pending'` rows older than 1 hour (S3 + DB).

---

## 6. Read Flow

`GET /api/files/:fileId/url?variant=256` → CQRS query `files:get-signed-read-url`.

- ScopedDb filters by tenantId; absent → 404.
- If `variant` provided: look up `transforms[].name === variant`, use that storage key. Else original.
- `relation.canRead(ctx, ownerRecordId)` if defined; deny on false.
- Return `{ url, expiresAt }` from `getFileStorage().signRead()`.

**Anti-pattern:** never expose raw `storage_key` in API responses. Browsers always go through `/api/files/:id/url`.

**Hot path:** `auth.queries.get-profile` resolves `avatarUrl` from latest user-file. MVP no caching — measure first.

---

## 7. Image Transform Pipeline

**Queue:** `image-transform`. **Job payload:** `{ fileId: string }`.

```ts
export const imageTransform = async (data: { fileId: string }) => {
  const file = await loadFileUnscoped(data.fileId);
  const relation = fileRelationsRegistry.get(file.ownerModule, file.ownerRecordType);
  if (!relation?.generateVariants) return;
  const original = await getFileStorage().getObject({ bucket: file.bucket, key: file.storageKey });
  const transforms: FileTransform[] = [];
  for (const variant of relation.generateVariants) {
    const out = await getImageTransform().resize({ input: original, ...variant });
    const variantKey = `${file.storageKey}.t.${variant.name}.${variant.format}`;
    await getFileStorage().putObject({ bucket: file.bucket, key: variantKey, body: out.output, mimeType: out.mimeType });
    transforms.push({ name: variant.name, storageKey: variantKey, mimeType: out.mimeType, byteSize: out.output.byteLength, width: out.width, height: out.height });
  }
  await unscopedDb().update(files).set({ transforms }).where(eq(files.id, data.fileId));
  const totalVariantBytes = transforms.reduce((s, t) => s + t.byteSize, 0);
  await unscopedDb().execute(sql`UPDATE tenant_storage_usage SET bytes_used = bytes_used + ${totalVariantBytes} WHERE tenant_id = ${file.tenantId}`);
};
```

**Sharp/Bun research item:** if Sharp's native bindings fail under Bun, swap `IMAGE_TRANSFORM_PROVIDER=imagescript` (pure JS fallback) without touching application code.

**Anti-pattern:** job handlers must NEVER call `wrapQueue` themselves — `createWorker` already wraps with ALS via Phase 20.

---

## 8. Health Contribution

`packages/modules/files/src/health/storage.ts` — aggregates quota across top-100 tenants by `bytes_used`, returns `healthy | degraded | unhealthy` based on % used. Wired into `ModuleDefinition.health`. `HealthAggregator` registers it through `registry.loadAll()` automatically.

---

## 9. UI Uploader Component

**Location:** `packages/ui/src/components/file-upload.tsx` + `packages/ui/src/hooks/use-file-upload.ts`.

**Hook (headless):**

```ts
export function useFileUpload(opts: {
  ownerModule: string; recordType: string; ownerRecordId: string;
  onSuccess?: (file: { fileId: string; readUrl: string }) => void;
}) {
  return { upload, progress, error, isUploading };
}
```

**Component:**
- Drag-drop via HTML5 `dragover`/`drop`.
- Progress via `XMLHttpRequest` upload events (Fetch has no upload progress).
- Image preview thumbnail when MIME matches `image/*`.
- shadcn primitives only.

**Eden Treaty client injection** via `<FileUploadProvider client={...}>` React context — keeps `packages/ui` free of `@baseworks/api-client` dep.

**Consumers:**
- `apps/web/app/(dashboard)/profile/page.tsx` — avatar upload
- `apps/web/app/(dashboard)/team/settings/page.tsx` — org logo
- `apps/admin/src/routes/tenants/$tenantId/files.tsx` (NEW) — admin file browser

---

## 10. Module File-Ownership Pattern (Polymorphic Association)

**Mechanism:**
1. Module declares `fileRelations: Record<recordType, FileRelation>` in `ModuleDefinition`.
2. Registry collects all relations at boot into `fileRelationsRegistry` (singleton in `@baseworks/module-files`).
3. Every CQRS command/query in the files module consults the registry to resolve spec, validate inputs, run permission hooks.
4. Modules NEVER import each other for file logic.

**Cascade on delete:** owning module emits event (e.g., `auth.user-deleted`); files module subscribes via `TypedEventBus` and runs cascade per-relation.

---

## 11. Integration Points: New vs Modified

### NEW

`packages/storage/*`, `packages/modules/files/*`, `packages/db/src/schema/storage.ts`, plus migration, UI components, runbook, alert template, integration doc.

### MODIFIED

| Path | Change |
|---|---|
| `packages/db/src/schema/index.ts` | Re-export new tables |
| `packages/db/src/index.ts` | Re-export (matches billing pattern at lines 16–20) |
| `packages/shared/src/types/module.ts` | Add `fileRelations?` to `ModuleDefinition`; export new types |
| `packages/shared/src/index.ts` | Export new types |
| `apps/api/src/core/registry.ts` | After health-registration block (lines 100–103), add `fileRelations` registration. Add `'files'` to `moduleImportMap` (line 12). |
| `apps/api/src/index.ts` | Mount files routes |
| `apps/api/src/worker.ts` | Register `image-transform` + `cleanup-pending` workers |
| `packages/config/src/env.ts` | Add `STORAGE_*` + `IMAGE_TRANSFORM_PROVIDER` keys |
| `packages/modules/auth/src/index.ts` | Add `fileRelations: { user, organization }` |
| `packages/modules/auth/src/queries/get-profile.ts` | Resolve `avatarUrl` from latest user-file |
| `docs/architecture.md` | Add file-storage Mermaid diagram |

### NOT TOUCHED (locked patterns)

- `packages/db/src/helpers/scoped-db.ts`
- `apps/api/src/core/cqrs.ts`, `event-bus.ts`, `health-aggregator.ts`
- `packages/observability/*`
- `packages/queue/src/index.ts`
- better-auth schema (`user`, `organization`)

---

## 12. Suggested Build Order (8 phases)

| Phase | Scope | Why this order |
|---|---|---|
| **24 — Foundation: Port + Schema** | `packages/storage/` ports + types + factory skeletons (Noop adapters), schema + migration, env additions | Locks contract before adapters exist |
| **25 — Adapters: Local + S3 + S3-compat** | All three adapters, conformance test suite (Phase 18 PII pattern) | Conformance proves all adapters behave identically |
| **26 — Files Module Skeleton + Sign-Upload + Quota** | Module shell, `sign-upload` + relations registry + quota check, `tenant_storage_usage` upsert. Add to `moduleImportMap`. Extend `ModuleDefinition`. | Endpoint live end-to-end with one mock relation |
| **27 — Complete-Upload + Read Flow + Delete** | `complete-upload` (stat verify + quota increment + emit event), `get-signed-read-url`, `list-files-for-record`, `delete-file` | Closes request/response loop without async transforms |
| **28 — Image Transform Pipeline** | `ImageTransform` port + Sharp adapter + imagescript fallback, `image-transform` BullMQ job, transforms manifest writes. Sharp-under-Bun smoke test as Phase-17-style subprocess gate. | Async path; Sharp/Bun research resolves here |
| **29 — Auth + Org Identity Wiring** | Auth module declares `fileRelations`, `get-profile` resolves `avatarUrl`, customer-app avatar/logo upload pages | First real consumer; proves cross-module decoupling |
| **30 — UI Uploader in `packages/ui`** | `<FileUpload>` + `useFileUpload` hook + a11y suite. Wire admin tenant-files browser. | Backend stable; hook design depends on full sign→PUT→complete flow |
| **31 — Cleanup + Reconciliation + Operator Surface** | `cleanup-pending` job, optional drift reconciliation, `HealthContributor` registered, runbook + Sentry alert template + integration docs | Mirrors v1.3's Phase 23 closing rhythm |

**Optional 31.5:** virus-scanning hook port + Noop adapter (decimal phase precedent). Out of scope per PROJECT.md; flagged for roadmapper consideration.

---

## 13. Pitfalls Specific to This Integration

| Pitfall | Mitigation |
|---|---|
| **CORS on the S3 bucket** must allow PUT from app origin or upload silently fails | Document config in `docs/integrations/file-storage.md`; ship Terraform snippet |
| **Sharp fails under Bun** | Phase 17-style subprocess smoke test gates phase 28. Fallback adapter (`imagescript`) is the immediate mitigation. |
| **Quota race condition** | `SELECT ... FOR UPDATE` on `tenant_storage_usage` inside the sign-upload transaction |
| **Orphan S3 objects** when `complete-upload` never called | Hourly `cleanup-pending` job. Quota does not increment until completion. |
| **Stat byteSize spoofing** | `complete-upload` re-reads byteSize from S3 stat (authoritative), uses that for quota math |
| **Permission hooks running expensive queries on hot paths** | Document 1-request-lifetime memoization pattern; advise modules to keep hooks fast |
| **Direct `storage_key` exposure leaks tenant taxonomy** | Hard rule: API only returns `{fileId, mimeType, byteSize, transforms[].name}` |
| **Cascade delete on event drop** orphans files | Reconciliation job sweeps files whose `(ownerModule, ownerRecordId)` no longer resolves |
| **`organization` is owned by better-auth** — extending its lifecycle hooks is brittle | Subscribe via `TypedEventBus`, NOT better-auth `databaseHooks` |
| **Migration ordering across worktrees** — every `.claude/worktrees/agent-*` may have its own `0001_*.sql` | Use `0002_v14_file_storage.sql` (drizzle-kit numbers automatically; verify before commit) |

---

## 14. Roadmap Implications

- **Phase count:** 8 (24–31). Decimal slot 31.5 reserved if virus-scanning surfaces.
- **Dependencies:** 24→25→26 strictly serial. 27 depends on 26. 28 can branch off 26 in parallel with 27 if a second contributor available, but conformance suite from 25 must be green first.
- **Highest-risk phase: 28** (Sharp under Bun). Recommend explicit research spike at phase entry; document decision in `docs/architecture.md`.
- **Lowest-risk phase: 30** (UI). All shadcn + Tailwind + vitest-axe patterns established.
- **Health + runbook closure** at phase 31 mirrors v1.3's Phase 23 closing rhythm.
- **No locked-pattern violations.**
