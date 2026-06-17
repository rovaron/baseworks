---
status: pending
phase: 29-identity-assets-fileupload
source: [29-PLAN-CONTRACT.md]
started:
updated:
---

## Current Test

[not started]

## Prerequisites

- Docker up: `docker compose up -d` (postgres + redis). `DATABASE_URL=postgres://baseworks:baseworks@localhost:5432/baseworks`, `REDIS_URL=redis://localhost:6379`.
- Migrations applied: `bun run db:migrate` (or `db:push`).
- Three shells from repo root:
  - `bun run apps/api/src/index.ts`  (API, port 3000)
  - `bun run apps/api/src/worker.ts` (BullMQ worker — REQUIRED for variant generation)
  - `cd apps/web && bun run dev`     (Next.js customer app)
- A signed-in user with an active organization where they hold the **owner** (or admin) role. Create via the signup flow if needed.

## Tests

### 1. Avatar upload + variants + denormalized avatarUrl (SC#1)
expected:
1. Navigate to `/profile`. The avatar shows the fallback (no uploaded avatar yet).
2. Drag a JPEG/PNG/WebP (< 5 MiB) onto the dropzone (or click → file picker). A live preview appears; the progress bar shows real bytes (not a synthetic jump to 100%).
3. On completion the avatar refreshes to the uploaded image (signed `avatarUrl` from `GET /api/profile`).
4. Within seconds the worker generates variants `avatar-64/128/256/512` (webp). Verify in DB:
   `psql $DATABASE_URL -c "select transforms from files where owner_record_type='user' and deleted_at is null order by created_at desc limit 1;"`
   → JSON contains the 4 webp variant keys.
5. `GET /api/profile` (authenticated, via the app or curl with the session cookie) returns `avatarUrl` = a signed, expiring URL (NOT a raw storage_key/bucket).
result:
evidence:

### 2. Org logo upload, owner-gated, variants, SVG rejected (SC#2)
expected:
1. As an **owner/admin**, navigate to `/team/settings`. The logo uploader is visible.
2. Upload a PNG/JPEG/WebP logo (< 5 MiB) → preview + progress → logo renders; worker generates `logo-128/256` webp variants (verify `transforms` as above with `owner_record_type='organization'`).
3. Attempt to upload an **SVG**: the upload is rejected at sign-time with a clear error (`mime_not_allowed`, surfaced as the `wrong_mime`/`sign_failed` error label). No file row is created, no quota consumed.
4. As a **member** (non-owner) user, navigate to `/team/settings`: the uploader is hidden/disabled (read-only logo). If forced (e.g. direct API attach), the server returns 403 (`forbidden`).
result:
evidence:

### 3. Cascade-on-replace + quota decrement (SC#4)
expected:
1. Note `bytes_used`: `psql $DATABASE_URL -c "select bytes_used from tenant_storage_usage where tenant_id='<tid>';"`.
2. Upload avatar A (and let variants generate). Re-check `bytes_used` (increased by A + its variants).
3. Upload avatar B (replacement). After it completes + attaches:
   - The prior file A is soft-deleted: `select status, deleted_at from files where id='<A>';` → `deleted` / non-null.
   - Only ONE live `user` file remains for the user (B): `select count(*) from files where owner_record_type='user' and owner_record_id='<uid>' and deleted_at is null;` → 1.
   - `bytes_used` decremented by A + A's variant bytes (no pile-up); now reflects only B + B's variants.
result:
evidence:

### 4. Cross-module decoupling (SC#3)
expected:
1. `bun run lint` → `lint:cross-module` passes (no `@baseworks/module-files` import in auth, none of `@baseworks/module-auth` in files).
2. `get-profile` resolves `avatarUrl` purely via `ctx.dispatch("files:list-for-record")` + `ctx.dispatch("files:get-read-url")` — confirm by grep that `queries/get-profile.ts` has zero files-module import.
result:
evidence:

### 5. In-flight navigation guard + cancel/retry (component SC#5/#1/#2)
expected:
1. Start a large-ish upload and attempt to navigate away / close the tab while it is uploading → the browser shows the `beforeunload` confirmation prompt.
2. Press Cancel mid-upload → the XHR aborts, item shows canceled, no orphan completes.
3. Kill the network (devtools offline) mid-upload → item shows the `network` error with a Retry action; Retry resumes from the failed step.
result:
evidence:

## Summary

total: 5
passed:
issues:
pending: 5
skipped:
blocked:

## Gaps
