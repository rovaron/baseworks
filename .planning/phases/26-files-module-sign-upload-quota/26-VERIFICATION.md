---
phase: 26-files-module-sign-upload-quota
verified: 2026-06-16T00:00:00Z
status: verified
score: 5/5 success criteria verified (fully local-verified against live Postgres)
environment_note: "Docker UP this session — Postgres healthy at DATABASE_URL=postgres://baseworks:baseworks@localhost:5432/baseworks; migrations 0000/0002/0003/0004 applied (files + tenant_storage_usage tables live). UNLIKE Phase 25, Phase 26 is fully verifiable locally — the SC#3 50-concurrent quota race ran against the REAL DB, not mocked."
---

# Phase 26: Files Module Skeleton + Sign-Upload + Per-Tenant Quota — Verification Report

**Phase Goal:** Stand up `packages/modules/files/` with the first end-to-end signing
flow — operator-configurable per-tenant quota enforced atomically at sign-time,
race-safe under 50 concurrent uploads, with the relations registry fully wired to
the boot path.
**Verified:** 2026-06-16
**Requirements:** UPL-01, UPL-03, QUO-01, QUO-02, MOD-02

## Verification environment

Docker was UP (Postgres healthy). `DATABASE_URL=… bun test packages/modules/files`
→ **22 pass / 0 fail** across 4 files (66 expect() calls). The two live-DB suites
(`quota.test.ts`, `on-tenant-created.test.ts`) executed against real Postgres;
`sign-upload.test.ts` and `build-storage-key.test.ts` are unit-level (raw drizzle
mocked, real `fileRelationsRegistry` / `setFileStorage` stub). No skips, no mocks
on the quota-race path.

## Success Criteria → Evidence

### SC#1 — Signed PUT URL bound to MIME+size, TTL ≤ 15 min, key built only by `buildStorageKey()` with mandatory `nanoid(24)` — VERIFIED

- **Command:** `packages/modules/files/src/commands/sign-upload.ts` — validates
  MIME against `relation.allowedMimeTypes` and `byteSize <= relation.maxByteSize`,
  signs with `expiresInSec: 900` (SIGN_TTL_SEC, ≤ 15 min), returns
  `{ fileId, method, url, headers, fields, expiresAt }` — never `storage_key`.
- **Key construction:** `src/lib/build-storage-key.ts` — the only key builder;
  `{tenantId}/{ownerModule}/{kind}/{nanoid(24)}{ext}`.
- **Evidence — TTL + no-key-leak:** `src/__tests__/sign-upload.test.ts` →
  *"happy path ⇒ ok with signed url and NO storage_key field (R4 / UPL-01)"*:
  asserts `method === "PUT"`, `ttlMs <= 900_000 + 5_000`, and the response keys
  exclude `storageKey`/`storage_key`/`key`/`bucket` and the tenant-prefixed key
  substring.
- **Evidence — mandatory nanoid(24):** `src/__tests__/build-storage-key.test.ts` →
  *"includes a mandatory 24-char nanoid segment"* (regex `^[A-Za-z0-9_-]{24}$`),
  *"produces {tenantId}/{ownerModule}/{kind}/{nanoid(24)}{ext} structure"*, MIME→ext
  mapping, and *"is collision-resistant across many calls"* (5000 unique ids).

### SC#2 — `tenant_storage_usage` row created on tenant.created with default `bytes_limit`; over-quota sign-upload ⇒ HTTP 413 + `quota_exceeded` — VERIFIED (live DB)

- **Hook:** `src/hooks/on-tenant-created.ts` — inserts the row with `bytes_limit =
  STORAGE_DEFAULT_QUOTA_BYTES`, `ON CONFLICT DO NOTHING`.
- **Env:** `packages/config/src/env.ts:79` —
  `STORAGE_DEFAULT_QUOTA_BYTES: z.coerce.number().int().positive().default(1073741824)`.
- **Evidence — row creation (LIVE DB):** `src/__tests__/on-tenant-created.test.ts` →
  *"creates one tenant_storage_usage row with the default bytes_limit"*: emits
  `tenant.created`, reads back the row, asserts `bytesLimit = 1_073_741_824`,
  `bytesUsed = 0`, `bytesPending = 0`, no `captureException`.
- **Evidence — 413 mapping:** `src/__tests__/sign-upload.test.ts` →
  *"quota reservation returns 0 rows ⇒ err('quota_exceeded') (QUO-02)"* (signing
  never attempted once the gate fails); route maps `quota_exceeded → 413`
  (`src/routes.ts:21`).
- **Evidence — over-quota rejection (LIVE DB):** `src/__tests__/quota.test.ts` →
  *"returns false (0 rows) when the reservation would exceed the limit"* (no pending
  bytes leaked on the rejected path).

### SC#3 — 50-concurrent load test at 95% quota proves no over-allocation; final `bytes_used + bytes_pending ≤ bytes_limit` — VERIFIED (LIVE DB, NOT mocked)

- **Test:** `src/__tests__/quota.test.ts` → describe *"SC#3 — 50 concurrent
  reservations are race-safe (live DB, NOT mocked)"* → *"exactly
  floor(remaining/perSize) succeed; no over-allocation"*.
- **Setup:** `bytes_limit = 1_000_000`, `bytes_used = 950_000` (95%),
  `per_upload = 2_000` ⇒ remaining 50_000 ⇒ **headroom = floor(50_000 / 2_000) =
  25**; `CONCURRENCY = 50` reservations fired via `Promise.all`.
- **Accepted-count vs headroom result:** **accepted = 25**, **rejected = 25**
  (`expect(accepted).toBe(25)`, `expect(rejected).toBe(25)`).
- **Invariant:** final `bytes_pending = 25 × 2_000 = 50_000`;
  `bytes_used + bytes_pending = 950_000 + 50_000 = 1_000_000 = bytes_limit` exactly
  (`expect(used + pending).toBeLessThanOrEqual(LIMIT)` and `.toBe(USED +
  EXPECTED_ACCEPTED * PER_SIZE)`) — **zero over-allocation**.
- **Mechanism:** single conditional `UPDATE` takes the row write-lock; Postgres
  EvalPlanQual recheck re-evaluates the `WHERE` against each prior committed winner
  (no `SELECT … FOR UPDATE`, no read-modify-write). `releaseQuota` GREATEST-floor
  verified by *"GREATEST-floors bytes_pending at 0 (no underflow)"*.

### SC#4 — registry collects `fileRelations` at boot; sign-upload looks up by `(ownerModule, kind)`, rejects unknown ⇒ HTTP 400 — VERIFIED

- **Boot wiring:** `apps/api/src/core/registry.ts:17` adds `files` to
  `moduleImportMap`; `loadAll()` collects each module's `fileRelations` into the
  process-wide `fileRelationsRegistry` (Phase 24). The command resolves the relation
  via `fileRelationsRegistry.get(ownerModule, kind)`.
- **Evidence — known relation resolves:** `src/__tests__/sign-upload.test.ts`
  registers a test relation into the **real** `fileRelationsRegistry` and the happy
  path resolves it (SC#1 evidence).
- **Evidence — unknown ⇒ 400:** same file → *"unknown (ownerModule, kind) ⇒
  err('unknown_relation') (MOD-02)"*; route maps non-`quota_exceeded` errors → 400
  (`src/routes.ts:21`). MIME/size rejections (*"disallowed MIME"*, *"oversize"*)
  likewise map to 400.

### SC#5 — cross-module file logic uses `TypedEventBus` only; no module→module imports (verified by import-graph rule); one `fileRelations` object DX — VERIFIED

- **Gate:** `scripts/lint-no-cross-module-imports.sh` bans any
  `from "@baseworks/module-…"` inside `packages/modules/*/src` (infra packages don't
  match the prefix and pass). Wired into the root `lint` chain and `lint-staged`.
- **Evidence — clean tree:** `bash scripts/lint-no-cross-module-imports.sh` → **exit
  0**. The files module imports only infra (`@baseworks/config`, `@baseworks/db`,
  `@baseworks/observability`, `@baseworks/shared`, `@baseworks/storage`,
  `@sinclair/typebox`, `drizzle-orm`, `elysia`, `nanoid`).
- **Sanctioned channel:** the tenant.created hook subscribes via
  `eventBus.on("tenant.created", …)` and the module emits `file.signed` — no package
  import crosses a module boundary.

## Score

**5/5 success criteria verified — fully local-verified against live Postgres.**
SC#3 (the 50-concurrent quota race) ran against the real DB and is the load-bearing
proof of the phase: accepted = 25 = headroom, rejected = 25, final used+pending =
limit exactly, zero over-allocation. Adversarial review: **0 blockers**.

## Human / CI verification required

None outstanding. All criteria, including the concurrency race, are machine-verified
locally against live Postgres.

_Verified: 2026-06-16 — Claude (gsd-verifier). Status: verified (fully local, no CI-gated components)._
