---
status: pending
phase: 30-admin-files-browser
source: [30-PLAN-CONTRACT.md]
started:
updated:
---

## Current Test

[not started]

## Prerequisites

- Docker up: `docker compose up -d` (postgres + redis). `DATABASE_URL=postgres://baseworks:baseworks@localhost:5432/baseworks`, `REDIS_URL=redis://localhost:6379`.
- Migrations applied: `bun run db:migrate`.
- `ADMIN_EMAILS` env contains the email of the account you will sign in with (the platform-admin allowlist consulted by `requirePlatformAdmin()`). Example: `ADMIN_EMAILS=you@example.com`.
- Three shells from repo root:
  - `bun run apps/api/src/index.ts`   (API, port 3000)
  - `bun run apps/api/src/worker.ts`  (BullMQ worker — REQUIRED for image variant generation)
  - `cd apps/admin && bun run dev`     (Vite admin dashboard, default http://localhost:5173)
- At least one tenant (organization) exists. If not, create one via the customer app signup flow, or pick any tenant id visible at `/tenants` in the admin dashboard.
- A second, NON-admin account (an email NOT in `ADMIN_EMAILS`) that owns/belongs to some organization — used for the negative authz test.

## Tests

### 1. Files tab is visible on tenant detail (platform admin)
expected:
1. Sign in to the admin dashboard with the platform-admin account (email in `ADMIN_EMAILS`).
2. Open `/tenants`, click any tenant to open `/tenants/:id`.
3. Below the existing two-column tenant/billing grid, a full-width **Files** card is present: an "Upload files" zone (drag-drop + "Choose file") and a files table (or an empty-state "No files for this tenant.").
result:
evidence:

### 2. Multi-file admin upload (multi mode) + list appears
expected:
1. In the Files card upload zone, select/drag MULTIPLE files at once (the zone is `multi`, up to 10): e.g. two JP/PNG/WebP images + one PDF, each < 10 MB.
2. Each shows a live progress bar (real XHR bytes, not a synthetic jump), then a "done" state. A "File uploaded." toast appears.
3. The files table refreshes (React Query invalidation on `onUploaded`) and lists every uploaded file: Name (original filename), Type (MIME), Size (KiB/MiB), Status, Created (relative time).
4. Try an oversize file (> 10 MB) or a disallowed type (e.g. `.gif`, `.svg`): it is rejected client-side (aria-live error) and, if it reaches the server, the API returns 413/400 — it never lands in the list.
result:
evidence:

### 3. Image variants appear after transform (worker required)
expected:
1. With the worker shell running, upload a raster image (JPEG/PNG/WebP). It first appears as **Uploaded/Processing**.
2. Within a few seconds the row auto-updates (bounded 3 s polling that stops at terminal status) to **Ready** with a "1 variants" hint (the `thumb-256` webp).
3. Confirm in DB:
   `psql $DATABASE_URL -c "select status, transforms from files where owner_record_type='tenant' and owner_module='files' and deleted_at is null order by created_at desc limit 1;"`
   → `transforms` JSON contains the `thumb-256` webp variant. A PDF upload stays variant-less (correct — PDF does not match the image gate).
4. With the worker STOPPED, an image upload still lists as **Uploaded** (no crash); variants simply do not generate.
result:
evidence:

### 4. View a file (signed read URL)
expected:
1. Click the View (eye) action on a Ready file. A new tab opens the signed, short-lived read URL — the image/PDF renders inline (or downloads per disposition).
2. The opened URL is a signed, expiring storage URL. Inspect the network response / DevTools: NO `storage_key` or `bucket` field appears in any `/api/admin/tenants/:id/files*` JSON response.
3. The View action is disabled while a file is still `pending`.
result:
evidence:

### 5. Delete a file — TARGET tenant quota decrements
expected:
1. Note the target tenant's `bytes_used`:
   `psql $DATABASE_URL -c "select bytes_used from tenant_storage_usage where tenant_id='<TARGET_TENANT_ID>';"`
2. Click Delete (trash) on a file → a focus-trapped confirm Dialog (labelled title + description) opens. Confirm.
3. A "File deleted." toast appears; the row disappears (soft delete).
4. Re-query `bytes_used` → it decremented by the file's own bytes **plus** any variant bytes (shared `softDeleteRow` refund). The TARGET tenant's row moved; no other tenant's usage changed.
result:
evidence:

### 6. Non-admin CANNOT reach the admin files endpoints (authz — CRITICAL)
expected:
1. Sign in (or obtain a session) as the NON-admin account (email NOT in `ADMIN_EMAILS`), including an account that is an **owner** of some organization.
2. With that session cookie, call each admin files route against ANY tenant id, e.g.:
   - `GET /api/admin/tenants/<id>/files`
   - `POST /api/admin/tenants/<id>/files/sign-upload` body `{"mimeType":"image/png","byteSize":1024}`
   - `POST /api/admin/tenants/<id>/files/<fileId>/complete`
   - `GET /api/admin/tenants/<id>/files/<fileId>/read-url`
   - `DELETE /api/admin/tenants/<id>/files/<fileId>`
3. Every call returns **403 Forbidden** (an org-owner is NOT a platform operator). With NO session, every call returns **401**.
4. Confused-deputy check: as the platform admin, POST sign-upload to tenant A's URL with an injected `{"tenantId":"<B>"}` field in the body — the file is created under tenant **A** (the gated `:id` path), and the extra body field is ignored. Quota is charged to A.
result:
evidence:

## Automated coverage (already GREEN — informational)

- `bun test packages/modules/files` — 98 pass / 0 fail. Includes the admin cross-tenant suite (`__tests__/admin-files.test.ts`): (a) sign+complete charge the TARGET tenant + key under target prefix; (b) list tenant-isolation; (c) no `storage_key`/`bucket` in any response (field + raw-key scan); (d) delete refunds own+variant bytes; (e) read-url returns `{url,expiresAt}` only and bypasses `canRead===false`; (f) quota_exceeded at limit; (g) image complete wires the transform enqueue; plus mime-not-allowed / oversize.
- `bun test apps/api/src` — 129 pass / 0 fail. `admin-auth.test.ts` asserts all 5 new files routes inherit `requirePlatformAdmin()` (401 no-session / 403 non-allowlisted).
- `cd apps/admin && bun run test` — 27 pass / 0 fail (`detail.files.test.tsx`: list renders, status badge + variant count, View calls read-url + `window.open`, Delete dialog + invalidation, `<FileUpload>` mounts with the admin adapters and an accessible aria-label).
- Root `bun run test` — exit 0 (per-root process isolation preserved).

## Notes / known-pending

- **chrome-devtools smoke: HUMAN-PENDING.** Not run automatically. The admin `tsc -b` typecheck step of `bun run build` is **pre-existing red** at HEAD (independent of Phase 30): `treaty<App>` in `@baseworks/api-client` makes `tsc -b` deep-typecheck the entire `apps/api` backend under the admin tsconfig, surfacing ~100+ pre-existing repo-wide type errors (billing react-email JSX templates, queue/billing test tuples, bullmq/ioredis resolution). The Vite compile (esbuild) and `bun run dev` are unaffected, so the dashboard runs — but a clean `bun run build` is not currently a precondition the stack meets, so the live browser smoke is left for a human operator. Phase 30's own admin source is type-clean (vitest + the eden adapters compile and run).
