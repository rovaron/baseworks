---
gsd_state_version: 1.0
milestone: v1.4
milestone_name: File Storage & Uploads
status: executing
stopped_at: Phase 30 complete (admin tenant-files browser + cross-tenant admin upload; backend live-DB-verified + admin UI vitest; Docker up)
last_updated: "2026-06-18T00:00:00.000Z"
last_activity: 2026-06-18
progress:
  total_phases: 8
  completed_phases: 7
  total_plans: 13
  completed_plans: 13
  percent: 88
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-05)

**Core value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.
**Current focus:** Phase 30 complete — the ADMIN files surface: five cross-tenant admin functions (explicit `targetTenantId`) + a generic `admin-attachment` `fileRelation` (collected at boot) + five `apps/api` admin routes behind `requirePlatformAdmin()` (target tenant from the gated `:id` path ONLY) + the `apps/admin` tenant-detail **Files** browser (list/view/delete + upload via the frozen Phase-29 `<FileUpload multi>`). Phase 31 (final — cleanup, reconciliation & operator surface) is next.

## Current Position

Milestone: v1.4 File Storage & Uploads
Phase: 30 (admin-files-browser) — COMPLETE (backend live-DB-verified + admin UI vitest; browser-E2E → 30-HUMAN-UAT; Docker up)
Plan: 1 of 1 (executed from 30-PLAN-CONTRACT.md)
Status: Phase 30 closed — the platform-admin cross-tenant files surface. Five admin functions in `packages/modules/files/src/commands/admin-files.ts` (`adminListFilesForTenant`/`adminSignUpload`/`adminCompleteUpload`/`adminGetReadUrl`/`adminDeleteFile`) are PLAIN async fns taking an EXPLICIT `targetTenantId` (NOT `ctx.tenantId`); authorization lives at the gated route, so they trust the caller and bypass per-relation `canRead`/`canWrite`. They reuse `reserveQuota`/`markUploaded`/`softDeleteRow`/`buildStorageKey`/`dispositionFor` unchanged, charging the TARGET tenant and keying under it. A generic `admin-attachment` `fileRelation` (recordType `tenant`; allow-list jpeg/png/webp/pdf — NO svg, NO gif; 10 MiB; one `thumb-256` webp variant; `cardinality:"many"`, `onDelete:"orphan"`; `canRead`/`canWrite=false` as public defense-in-depth) is declared on the files module's OWN `ModuleDefinition` and collected by the existing boot-time `collectFileRelations` into `fileRelationsRegistry` (no apps/api boot change). Five routes on `apps/api/src/routes/admin.ts` inherit the single `.use(requirePlatformAdmin())` (allowlist-only — a per-org owner is 403, never conflated with a platform operator) and derive the target tenant from the gated `:id` path param ONLY — the sign-upload body is `{mimeType,byteSize,originalFilename?}` with NO `tenantId` field (confused-deputy closed); `kind` is fixed server-side; sign verifies `organization` existence → 404 before reserving (no orphan usage row). `enqueueTransform` was EXTRACTED from the `file.completed` subscriber and shared by both the public and admin complete paths (subscriber behaviour unchanged, `enqueue-on-completed.test.ts` green) so admin image uploads transform into variants. The `apps/admin` tenant-detail **Files** card lists files (name/type/size/status+variantCount/created) via React Query with a bounded `refetchInterval` that stops at terminal status, opens signed read-urls in a new tab (view), soft-deletes through a focus-trapped confirm `Dialog`, and uploads via the FROZEN Phase-29 `<FileUpload multi>` wired through new admin sign/complete adapters; en+pt-BR `tenants.detail.files.*` i18n + the `files` namespace registered in the admin app. `storage_key`/`bucket` never in any response (explicit column projection + a response-scan test). `DATABASE_URL=… REDIS_URL=… bun test packages/modules/files/.../admin-files.test.ts` → 8 pass / 0 fail (40 expects: target-tenant charge + key prefix, cross-tenant list isolation, no-key-leak scan, refund incl. variant bytes, read-url bypass of `canRead===false`, quota_exceeded, enqueue-on-image-complete, mime/oversize rejects); full files module → 98 pass / 0 fail; `apps/api/.../admin-auth.test.ts` (401 no-session / 403 non-allowlisted across all 5 endpoints) → 14 pass / 0 fail; `apps/admin` vitest → 27 pass / 0 fail (`detail.files.test.tsx` = 7). The admin `tsc -b` build surfaces the PRE-EXISTING repo-wide cross-package module-resolution state (apps/api + observability, not Phase 30 source), so the admin UI is verified via vitest (the contract's named gate). Adversarial review: 0 blockers + 3 warnings (publicly-signable global relation → `canRead/canWrite=false` + Phase-31 sweep; storage_key/bucket leak → explicit projection + scan test; async-variant polling → bounded refetch stopping at terminal status), all addressed. Browser-E2E → `30-HUMAN-UAT.md`.
Status (prior): Phase 29 closed — auth/org identity assets via declared `fileRelations` (avatar/logo), signed `avatarUrl` through `ctx.dispatch` (zero files↔auth import), cascade-on-replace via shared `lib/soft-delete.ts`, and the absorbed-forward reusable `<FileUpload>`/`useFileUpload` in `packages/ui` wired into `/profile` + `/team/settings`. (Phases 24–28: storage ports + schema, three storage adapters + conformance, files module + race-safe quota, complete-upload + read-url + delete + attachments, image transform pipeline — all closed and live-DB/CI-verified.)
Next: Phase 31 (final) — Cleanup, Reconciliation & Operator Surface: storage `HealthContributor` in `/health/detailed`, scheduled cleanup/reconciliation cron jobs (reap-pending, reap-orphan, reap-soft-deleted, reconcile-usage), runbooks + Sentry alert templates + file-storage integration docs (QUO-03, OPS-01, OPS-02, OPS-03). Carryover: confirm the `auth.user-deleted` cascade producer (`{tenantId,recordId}`, pinned Phase 27) lands within Phase 31 if not already emitted.
Last activity: 2026-06-18

Progress (v1.4): [████████--] 7 of 8 phases (88%)

### Roadmap Evolution

- **2026-06-18** — Phase 30 (Admin Tenant-Files Browser + Admin Upload) closed. Executed from a single LOCKED `30-PLAN-CONTRACT.md`. UI-02 satisfied — the FULL platform-admin cross-tenant files surface. Five admin functions (`packages/modules/files/src/commands/admin-files.ts`) are PLAIN async fns taking an EXPLICIT `targetTenantId` (NOT `ctx.tenantId`); the gated route is the authorization boundary, so they trust the caller and bypass per-relation `canRead`/`canWrite`, reusing `reserveQuota`/`markUploaded`/`softDeleteRow`/`buildStorageKey`/`dispositionFor` unchanged and charging the TARGET tenant. A generic `admin-attachment` `fileRelation` (jpeg/png/webp/pdf — NO svg/gif; 10 MiB; one `thumb-256` webp; `canRead`/`canWrite=false` for public defense-in-depth) is declared on the files module's own `ModuleDefinition` and collected by the existing boot-time `collectFileRelations` (no apps/api boot change). Five routes on `apps/api/src/routes/admin.ts` inherit the single `.use(requirePlatformAdmin())` (`ADMIN_EMAILS` allowlist only — a per-org owner is 403, never conflated with a platform operator) and derive the target tenant from the gated `:id` path param ONLY (sign body has NO `tenantId`; `kind` fixed server-side; sign verifies tenant existence → 404). `enqueueTransform` was extracted from the `file.completed` subscriber and shared by both the public and admin complete paths so admin image uploads transform into variants. The `apps/admin` tenant-detail Files card lists/views/deletes a tenant's files (bounded `refetchInterval` so async webp thumbnails surface) and uploads via the FROZEN Phase-29 `<FileUpload multi>` through new admin sign/complete adapters, en+pt-BR i18n. `storage_key`/`bucket` never in any response (explicit projection + scan test). `bun test .../admin-files.test.ts` → 8/0; full files module → 98/0; `admin-auth.test.ts` (401/403 across all 5 endpoints) → 14/0; `apps/admin` vitest → 27/0. Adversarial review: 0 blockers + 3 warnings (publicly-signable global relation; key-leak; async-variant polling), all addressed. Phase 31 (final — cleanup, reconciliation & operator surface) is next.
- **2026-06-17** — Phase 29 (Auth & Org Identity Asset Wiring) closed, and SCOPE EVOLVED: per operator decision the phase ABSORBED the reusable `<FileUpload>`/`useFileUpload` component the roadmap had placed in Phase 30 (built to the full Phase 30 component spec). IDA-01/IDA-02 satisfied — auth declares `fileRelations: { user, organization }` (avatar 64/128/256/512 webp; logo 128/256 webp), SVG excluded from both allow-lists and rejected at sign-time, owner/admin write-gating reads auth's OWN `member` table (no files import); `get-profile` resolves a signed `avatarUrl` from the latest user-kind file purely through `ctx.dispatch` (ZERO `@baseworks/module-files` import — the Phase 26/29 decoupling proven end-to-end, `lint:cross-module` green); cascade-on-replace via a new `FileRelation.cardinality:"single"` makes `attach-file` soft-delete prior owner-tuple files and decrement `bytes_used` (+ variant bytes) through an EXTRACTED `lib/soft-delete.ts` shared with `delete-file`. The backend-agnostic `<FileUpload>` (no api-client/apps import — injected `sign`/`complete`/`onUploaded`) shipped with drag-drop + picker fallback, real XHR byte progress, object-URL preview, cancel/retry, single+multi mode, the `s3-put|s3-post|local` `kind` discriminator, all error states, the `beforeunload` guard, en+pt-BR `files` i18n namespace, and a vitest-axe a11y test — wired into `/profile` + `/team/settings` via `GET /api/profile` + the Eden client. `bun test packages/modules/files` → 90/0; auth file-relations+get-profile → 15/0; `file-upload.a11y.test.tsx` → 8/0. Adversarial review: 0 blockers + 2 warnings, addressed. CONSEQUENCE: **Phase 30 reduced** to the admin tenant-files browser (`list-for-record`) + multi-mode polish (the component is already frozen + shipped). Browser-E2E (drag→variants, beforeunload prompt, member-403) → `29-HUMAN-UAT.md` (not a blocking gate).
- **2026-06-17** — Phase 28 (Image Transform Pipeline) closed. Executed from a single LOCKED `28-PLAN-CONTRACT.md`. IMG-01/IMG-02/IMG-03 satisfied. The phase-entry gate (spike S-1) was GREEN before any work — sharp resizes + encodes webp + reads metadata under Bun inside `oven/bun:1` (operator-verified: `SHARP_OK bytes=86 fmt=webp w=50 isWebp=true`) — so sharp stayed the DEFAULT adapter and was NOT re-litigated; the committed `bun-docker-spike.test.ts` makes CI/Docker re-run the proof. `imagescript` is the env-selectable pure-JS fallback: it CAN encode webp/jpeg/png but CANNOT decode webp (handled honestly via `caps.canDecodeWebp=false`, not faked), and its `metadata()` uses a dedicated header parser so the bomb pre-flight never OOMs. Both adapters pass one shared conformance suite. The async pipeline (`file.completed` → `image-transform` BullMQ queue → `concurrency:2` worker → `files.transforms` manifest at deterministic keys, Phase-20 trace propagation, signed retry-safe quota delta) and the 3-layer decompression-bomb defense (20 MB `/complete` cap → sharp `limitInputPixels:50M`+`failOn:'warning'` → worker `metadata()` >50M structured reject) are all proven, the latter by the 50000×50000 fixture returning `file.transform-failed` with no crash. EXIF is stripped from every variant (sharp drops metadata by default; verified by an EXIF-bearing round-trip gate). UNLIKE the worry that sharp might not load off-Docker, its win32-x64 prebuilt loaded on the Windows dev host so the sharp conformance + smoke RAN locally (18/18), not just in CI. `bun test packages/modules/files` → 87 pass / 0 fail. Adversarial review: 2 blockers (librsvg source-format allow-list; dynamic `createQueue` import to protect the hooks import graph) + 4 warnings, all addressed.
- **2026-06-16** — Phase 27 (Complete-Upload + Signed Read URLs + Delete + Generic Attachments) closed. Executed from a single LOCKED `27-PLAN-CONTRACT.md`. UPL-02/UPL-04/ATT-01/ATT-02/MOD-03 satisfied: server-authoritative `/complete` (`stat()` size + `file-type` magic-byte on first 4 KiB; reject = delete object + row + release pending), per-request signed read URLs (`STORAGE_SIGNED_URL_TTL_SEC`, no raw key ever in a response), soft-delete with quota refund + `file.deleted` event, and the generic attach/list-for-record API. Cross-module invocation solved WITHOUT imports via a new string-keyed `ctx.dispatch` (`HandlerContext` + `apps/api` scoped derive self-reference) — satisfies both the Phase 26 cross-module ban and the Phase 29 files↔auth ban. Cascade-on-delete is a registry-derived event subscriber proven by an in-test emit (auth has no `user-deleted` producer until Phase 29; the `{tenantId,recordId}` contract is pinned here). Quota conservation: `markUploaded` decrements `bytes_pending` by the RESERVED size and increments `bytes_used` by the AUTHORITATIVE size in one atomic statement; the `status='pending'` guard makes completion count-once under concurrency. Fully verified against live Postgres with a temp-rooted LocalFileStorage — 69 pass / 0 fail. Adversarial review: 1 blocker + 5 warnings, all addressed.
- **2026-06-16** — Phase 26 (Files Module + Sign-Upload + Per-Tenant Quota) closed. Executed from a single LOCKED `26-PLAN-CONTRACT.md`. UPL-01/UPL-03/QUO-01/QUO-02/MOD-02 satisfied: `packages/modules/files/` is the first end-to-end file flow (billing as the structural analog). Quota race-safety is a single atomic conditional `UPDATE` (Postgres EvalPlanQual recheck under the row write-lock) — no `SELECT … FOR UPDATE`, no read-modify-write. UNLIKE Phase 25 (Docker down ⇒ S3/MinIO CI-gated), Docker was UP so Phase 26 ran fully against live Postgres, including the SC#3 50-concurrent race: at 95% quota, accepted=25=headroom, rejected=25, final used+pending=limit exactly (zero over-allocation). 22 pass / 0 fail. Adversarial review: 0 blockers.
- **2026-06-16** — Phase 25 (Test Infra + Three Storage Adapters) closed. Executed from a single LOCKED `25-PLAN-CONTRACT.md` rather than numbered sub-plans. FILE-02 + FILE-03 satisfied: three `FileStorage` adapters (Local/S3/S3-compat) proven equivalent by one shared `runFileStorageConformance` suite; Local + HMAC signing + CORS validator + deterministic fixtures verified locally; S3/S3-compat object-I/O conformance CI-gated on a MinIO service container (folded into `validate.yml` `ci`, not a separate workflow). Adversarial review: 0 blockers. One non-blocking follow-up: add the fixture-hash reproducibility test (`fixtures.test.ts`).
- **2026-05-05** — v1.4 milestone roadmap created. 8 phases (24–31) derived from 25 requirements across 9 categories (FILE/UPL/IMG/QUO/MOD/IDA/ATT/UI/OPS). All 25 requirements mapped to exactly one phase, no orphans. Highest-risk phase is Phase 28 (Image Transform Pipeline) — sharp under Bun in Docker is the one MEDIUM-confidence stack item; the phase begins with a research spike (S-1) on the target Docker base image, with `imagescript` wired as the failover. One variance from research §7 proposal: FILE-02 moved from Phase 24 to Phase 25 (the conformance suite is the deliverable that proves the port, and it runs in Phase 25 against real adapters).
- **2026-04-26** — Phase 20.1 inserted after Phase 20: Close v1.3 milestone gaps from observability UAT (URGENT). Bundles 3 todos: drizzle migration journal repair, billing `getSubscriptionStatus` TypeError fix, and obsContext.traceId ↔ OTel server-span trace_id bridge. All three surfaced during live v1.3 milestone UAT against a real Sentry DSN + authenticated session + BullMQ producer/consumer round-trip on 2026-04-26.

## Performance Metrics

**Velocity:**

- Total plans completed: 121 (15 v1.0 + 24 v1.1 + 19 v1.2 + 38 v1.3 + 25 quick tasks/decimal-phase work)
- Timeline: v1.0 shipped in 3 days, v1.1 in 6 days, v1.2 in 6 days, v1.3 in 13 days

**Previous milestone (v1.3):**

- 38 plans, 7 phases (17-23, with 21 deferred and 20.1 inserted), 13 days
- 239 commits, 21/28 requirements satisfied (5 deferred to v1.4 — Phase 21; 2 with operator UAT carryover — EXT-01, OPS-02)

**v1.4 estimate:** 8 phases planned. Based on 5-plan-per-phase median across v1.0–v1.3, expect ~30–45 plans across the milestone. Phase 28 (image transforms with sharp/Bun spike) carries the highest single-phase risk and may surface a decimal phase if the S-1 spike forces architectural pivots.

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table (last updated at v1.3 close with entries covering observability ports, OTEL bootstrap discipline, scrubPii defense-in-depth, single SentryErrorTracker class via `kind`, AsyncLocalStorage<ObservabilityContext>, external CqrsBus/EventBus wrappers, synthetic OTel SpanContext seed at Bun.serve fetch boundary, traceparent always-trust default with hardening deferred, runbooks-as-templates operator surface, and HealthContributor worst-of-N rollup pattern).

**v1.4 Roadmap Decision (2026-05-05):**

- **FILE-02 mapped to Phase 25, not Phase 24** — research §7 proposed FILE-02 in Phase 24 as "port skeleton". Goal-backward analysis: the requirement says "conformance test suite proves all 3 adapters behave identically." That proof happens in Phase 25 against real adapters; Phase 24 only ships Noop scaffolds. Mapping a requirement to the phase where it is *proven* (not where its scaffolding starts) keeps success criteria honest.
- [Phase ?]: Plan 24-01: ImageVariantSpec landed canonically in @baseworks/shared one plan early to satisfy soft cross-plan dep in sequential execution. Format union restricted to webp|jpeg|png (T-24-01-02). Storage port surface locked: FileStorage 6 methods, ImageTransform resize+metadata; SignedUpload/SignedRead deliberately omit storage_key (T-24-01-01).
- [Phase ?]: ImageVariantSpec landed early (Plan 24-01) per soft cross-plan dependency; Plan 24-02 used the canonical declaration as-is.
- [Phase ?]: All Phase 24-28 columns (status, transforms, deleted_at, bytes_pending) declared up front in Plan 24-02 to avoid mid-flight enum/column migrations (D-01..D-04).
- [Phase ?]: Migration 0002_v14_file_storage hand-edited after drizzle-kit generate to add CHECK constraint (D-01) and partial-index WHERE deleted_at IS NULL (D-04); idx 1 intentionally skipped to honor locked tag.
- [Phase ?]: Plan 24-03: FileRelation+fileRelations? added in @baseworks/shared; ImageVariantSpec auto-resolved by 24-01 (soft cross-plan dep)
- [Phase ?]: Plan 24-07: Path-allowlist for no-direct-files-table-access lives in scripts/lint-no-direct-files-access.sh ONLY (Biome 2.4.10 GritQL plugins lack a built-in path-allowlist primitive). packages/modules/files/** is pre-allow-listed for Phase 26.
- [Phase ?]: Stack-trace adapter identity preserved via per-adapter source dir slug (Bun stack frames omit class names for instance methods)
- [Phase ?]: Plan 24-05: fileRelationsRegistry singleton in @baseworks/storage with Zod runtime validation (D-07) and two-level key per D-08
- [Phase ?]: Plan 24-06: bun run db:migrate applied both pending migrations (0002_v14_file_storage + 0003_audit_indexes) in one run; count 1 -> 3. Both storage tables live with CHECK + partial index.
- [Phase ?]: Plan 24-06: pre-existing repo-wide tsc rootDir state (132 errors) + 9 audit-era bun-test failures are out of scope; logged to phase deferred-items.md for a future tooling task.

### Pending Todos

None at roadmap-creation time. Will accumulate as plans execute.

### Blockers/Concerns

None blocking. Research flags surfaced for v1.4 implementation:

- **Phase 28 (HIGHEST-risk)** — Sharp under Bun + Docker is MEDIUM-confidence. Spike S-1 (smoke test on `oven/bun:1-debian-slim` x64 + arm64) is the phase-entry gate; if RED, pivot to `imagescript` as default. The phase MUST NOT proceed with sharp as default until the spike passes.
- **Phase 25** — Spike S-2 (POST policy enforcement matrix per S3-compat backend) is non-blocking; PUT covers all v1.4 needs and POST is deferred. Spike runs to document the matrix for future POST opt-in.
- **Phase 25** — Spike S-3 (`aws-sdk-client-mock` Bun compatibility) is non-blocking; MinIO-in-CI is the primary harness so any mock-library quirk has a fallback.

Prior concerns (v1.3 carryovers, not v1.4 scope — see Deferred Items below).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260420-a4t | Route packages/ui tests through vitest (eliminated 22 `document is not defined` failures from `bun test`) | 2026-04-20 | 1a00bfc | [260420-a4t-route-packages-ui-src-test-tsx-through-v](./quick/260420-a4t-route-packages-ui-src-test-tsx-through-v/) |
| Phase 24 P01 | 7min | 3 tasks | 11 files |
| Phase 24 P24-02 | 6min | 3 tasks | 7 files |
| Phase 24 P24-03 | 4min | 1 tasks | 3 files |
| Phase 24 P07 | 8min | 2 tasks | 6 files |
| Phase 24 P24-04 | 6min | 3 tasks | 11 files |
| Phase 24 P24-05 | 2min | 1 tasks | 3 files |
| Phase 24 P06 | 12min | 4 tasks | 5 files |

## Deferred Items

Items acknowledged and deferred at v1.3 milestone close on 2026-05-05. All are operator-gated (require production deploy or deferred Phase 21 stack), not implementation gaps. Survive into v1.4 for resolution when production deploy + observability stack are stood up.

| Category | Item | Status |
|----------|------|--------|
| uat_gap | Phase 18 — 18-HUMAN-UAT.md | partial (4 skipped pending prod deploy) |
| uat_gap | Phase 20 — 20-HUMAN-UAT.md | partial (1 blocked on Phase 21 — deferred to v1.4+) |
| uat_gap | Phase 20.1 — 20.1-HUMAN-UAT.md | passed (audit flagged status field non-canonical) |
| verification_gap | Phase 18 — 18-VERIFICATION.md | human_needed (operator gate: Sentry release workflow secrets + test tag) |
| verification_gap | Phase 20 — 20-VERIFICATION.md | human_needed (Tempo backend — Phase 21 deferred) |
| verification_gap | Phase 20.1 — 20.1-VERIFICATION.md | human_needed |
| verification_gap | Phase 22 — 22-VERIFICATION.md | human_needed (4 manual UAT items: CSP iframe, cookie share, worker dead-status, pt-BR locale) |
| todo | 2026-04-26-harden-inbound-traceparent-trust-gate.md | api — pending |

## Session Continuity

Last session: 2026-06-18
Stopped at: Phase 30 closed (admin-files-browser; five cross-tenant admin files fns with explicit `targetTenantId` + `admin-attachment` relation collected at boot + five `apps/api` routes behind `requirePlatformAdmin()` deriving the tenant from the gated `:id` ONLY + the `apps/admin` tenant-detail Files browser consuming the frozen `<FileUpload multi>`; backend live-DB-verified + admin UI vitest; Docker up)
Resume file: None
Next action: `/gsd:plan-phase 31` — Cleanup, Reconciliation & Operator Surface (FINAL phase of v1.4). Storage `HealthContributor` in `/health/detailed` (top-N tenants by `bytes_used`, % quota, aggregate adapter health), four cron jobs (`cleanup:reap-pending-uploads` hourly, `cleanup:reap-orphan-files` daily, `cleanup:reap-soft-deleted` weekly, `quota:reconcile-tenant-usage` daily), 4 runbooks + 2+ Sentry alert templates (`runbook_url` CI cross-link gate), and `docs/integrations/file-storage.md` (CORS templates, lifecycle policies, CDN/Cache-Control, sharp Docker base-image pin). Requirements QUO-03, OPS-01, OPS-02, OPS-03. Fold in HUMAN-UAT carryover from `29-HUMAN-UAT.md` + `30-HUMAN-UAT.md` once the full stack is stood up. Carryover: confirm the `auth.user-deleted` cascade producer (`{ tenantId, recordId }`, pinned Phase 27) lands within Phase 31 if not already emitted.
