---
phase: 22
slug: admin-ops-tooling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bun test (backend) + vitest (admin SPA) |
| **Config file** | `bunfig.toml` (backend) / `apps/admin/vite.config.ts` (frontend) |
| **Quick run command** | `bun test apps/api/src/{routes,core,worker} packages/{queue,shared,observability,config} --bail=1` |
| **Full suite command** | `bun test && bun run --filter @baseworks/admin test` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Populated by planner. Each row maps a plan task to a falsifiable check.
> See `22-RESEARCH.md` §"Validation Architecture" for the canonical falsifiable checks per REQ-ID and per success criterion — planner must lift each one into a row here.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | OPS-01 | TBD | bull-board mounted at /admin/bull-board behind requireRole("owner"), read-only by default | integration | `bun test apps/api/test/admin-bull-board.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPS-02 | TBD | Admin sidebar Job Monitor entry renders bull-board iframe | unit + e2e | `bun run --filter @baseworks/admin test src/routes/jobs.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPS-03 | TBD | /health/detailed returns shape with queues/workers/db/recentErrors/modules | integration | `bun test apps/api/test/health-detailed.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OPS-04 | TBD | HealthContributor slot collected by registry, aggregator rolls up | unit | `bun test apps/api/src/core/health-aggregator.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | EXT-02 | TBD | Worker publishes Redis heartbeat key on configured interval; cleared on shutdown | integration | `bun test apps/api/test/worker-heartbeat.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/api/test/admin-bull-board.test.ts` — stubs for OPS-01 (401/403/static-asset gating, CSP frame-ancestors, readOnlyMode env-driven)
- [ ] `apps/api/test/health-detailed.test.ts` — stubs for OPS-03 (response shape, RBAC, status rollup)
- [ ] `apps/api/src/core/health-aggregator.test.ts` — stubs for OPS-04 (Promise.allSettled + per-contributor timeout, worst-of-N rollup)
- [ ] `apps/api/test/worker-heartbeat.test.ts` — stubs for EXT-02 (Redis SET with EX, instanceId resolution, cleanup on SIGTERM)
- [ ] `apps/admin/src/routes/jobs.test.tsx` — stubs for OPS-02 (iframe renders, fills layout main slot)
- [ ] `apps/admin/src/routes/system/health-detailed.test.tsx` — stubs for OPS-03 admin UI (queue thresholds, worker status, recent errors)
- [ ] `apps/api/test/error-tracker-ringbuffer.test.ts` — stubs for recent-errors ringbuffer (capacity 50, dedup, decorator pass-through)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Iframe sharing better-auth session cookie via same-origin proxy | OPS-02 | Browser cookie behavior under reverse-proxy — automated headless test is brittle | Run `bun run dev` (root), open `http://localhost:5173/jobs` while authenticated as owner, confirm iframe loads bull-board with no second login |
| CSP `frame-ancestors '${ADMIN_URL}'` blocks foreign-origin embedding | OPS-01 | Browser-enforced; integration test only checks header presence, not enforcement | Open a malicious-origin HTML file with `<iframe src="http://localhost:3000/admin/bull-board">`; confirm browser console shows CSP violation |
| Worker heartbeat shows `dead` after process kill | EXT-02 | Requires SIGKILL of worker process and 75s wait — slow test | Kill worker via `pkill -9 -f bun.*worker`, wait 80s, curl `/health/detailed`, confirm worker.status === "dead" |
| pt-BR translation for nav.jobs renders correctly | OPS-02 | Visual locale review | Switch admin app to pt-BR locale, confirm sidebar shows "Monitor de Jobs" |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
