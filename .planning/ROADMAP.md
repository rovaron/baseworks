# Roadmap: Baseworks

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-5 (shipped 2026-04-08)
- ✅ **v1.1 Polish & Extensibility** -- Phases 6-12 (shipped 2026-04-16)
- ✅ **v1.2 Documentation & Quality** -- Phases 13-16 (shipped 2026-04-21)
- 🚧 **v1.3 Observability & Operations** -- Phases 17-23 (started 2026-04-21)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) -- SHIPPED 2026-04-08</summary>

- [x] Phase 1: Foundation & Core Infrastructure (3/3 plans) -- completed 2026-04-06
- [x] Phase 2: Auth & Multitenancy (3/3 plans) -- completed 2026-04-06
- [x] Phase 3: Billing & Background Jobs (4/4 plans) -- completed 2026-04-07
- [x] Phase 4: Frontend Applications (3/3 plans) -- completed 2026-04-07
- [x] Phase 5: Production Hardening (2/2 plans) -- completed 2026-04-08

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Polish & Extensibility (Phases 6-12) -- SHIPPED 2026-04-16</summary>

- [x] Phase 6: Responsive Layouts (3/3 plans) -- completed 2026-04-08
- [x] Phase 7: Accessibility (4/4 plans) -- completed 2026-04-09
- [x] Phase 8: Internationalization (3/3 plans) -- completed 2026-04-09
- [x] Phase 9: Team Invites (5/5 plans) -- completed 2026-04-11
- [x] Phase 10: Payment Abstraction (4/4 plans) -- completed 2026-04-11
- [x] Phase 11: Accessibility Gap Closure (2/2 plans) -- completed 2026-04-14
- [x] Phase 12: i18n Hardcoded String Cleanup (3/3 plans) -- completed 2026-04-14

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Documentation & Quality (Phases 13-16) -- SHIPPED 2026-04-21</summary>

- [x] Phase 13: JSDoc Annotations (4/4 plans) -- completed 2026-04-16
- [x] Phase 14: Unit Tests (6/6 plans) -- completed 2026-04-17
- [x] Phase 15: Developer Documentation (6/6 plans) -- completed 2026-04-18
- [x] Phase 16: v1.2 Content Drift Fixes (3/3 plans) -- completed 2026-04-19

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

### Active Milestone: v1.3 Observability & Operations

- [x] Phase 17: Observability Ports & OTEL Bootstrap (5/5 plans) -- completed 2026-04-22
- [x] Phase 18: Error Tracking Adapters (7/7 plans) -- completed 2026-04-23 (EXT-01 operator gate deferred to 18-HUMAN-UAT.md)
- [x] Phase 19: Context, Logging & HTTP/CQRS Tracing (8/8 plans) -- completed 2026-04-23
- [x] Phase 20: BullMQ Trace Propagation (0/3 plans) (completed 2026-04-26)
- [x] Phase 20.1: Close v1.3 milestone gaps from observability UAT (4/4 plans) (INSERTED) (completed 2026-04-26)
- [~] Phase 21: OTEL Adapters + Grafana Observability Stack — DEFERRED to v1.4+ (Sentry SaaS covers metrics/dashboards/alerts; observability ports remain in place for fork users to wire OTLP later)
- [x] Phase 22: Admin Ops Tooling (0/0 plans) (completed 2026-04-27)
- [ ] Phase 23: Runbooks, Alert Templates & Observability Docs (0/0 plans)

Full details: [milestones/v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)

### Phase 22: Admin Ops Tooling

**Goal**: Admin user can monitor jobs and system health from the Vite admin dashboard without leaving the app, with bull-board gated by RBAC and read-only by default.
**Depends on**: Phase 20 (Phase 21 deferred 2026-04-27 — see deferral note in milestones/v1.3-ROADMAP.md)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, EXT-02
**Success Criteria** (what must be TRUE):
  1. Operator sees `@bull-board/elysia` mounted at `/admin/bull-board` behind `requireRole("owner")` with read-only mode enabled by default via feature-flag env and admin-origin CSP; unauthenticated requests return 401, non-admin return 403, and static asset requests are also gated
  2. Admin user sees a "Job Monitor" entry in the Vite admin dashboard sidebar that renders bull-board as a same-origin iframe sharing the better-auth session cookie
  3. Admin user sees a `/health/detailed` endpoint and matching admin dashboard page showing queue depth with warn/critical thresholds, worker heartbeat freshness, DB lag, recent errors, and per-module status
  4. Module author sees a `HealthContributor` registered at module registration time; the central aggregator rolls up all contributions into an overall status surfaced by the admin health page
  5. Operator sees workers publishing heartbeat keys to Redis on a configurable interval so the health dashboard worker-heartbeat status reflects real state, not a mock
**Plans**: 6 plans
  - [x] 22-01-PLAN.md — Foundation: env vars, HealthContributor types, instance-id helper, RingBufferingErrorTracker decorator (no mounts)
  - [x] 22-02-PLAN.md — HealthAggregator class + ModuleRegistry def.health collector
  - [x] 22-03-PLAN.md — bull-board mount at /admin/bull-board with RBAC + CSP + readOnly env
  - [x] 22-04-PLAN.md — Worker heartbeat publisher + reader (Redis SET worker:heartbeat:{instanceId})
  - [x] 22-05-PLAN.md — /health/detailed endpoint + built-in contributors + ringbuffer wiring
  - [x] 22-06-PLAN.md — Admin frontend: vite proxy, /jobs iframe, /system page replacement, i18n keys
**UI hint**: yes

### Phase 23: Runbooks, Alert Templates & Observability Docs

**Goal**: Operator paged at 3am has a linked runbook for every alert and a short doc explaining how attributes, cardinality, and trace propagation work in this codebase.
**Depends on**: Phase 22 (Phase 21 deferred 2026-04-27 — Grafana alert YAML scope drops with it; Sentry alert templates remain in scope)
**Requirements**: DOC-03, DOC-04
**Success Criteria** (what must be TRUE):
  1. Operator sees 8–10 incident runbooks under `docs/runbooks/` covering DB down, Redis down, queue backing up, webhook failures, auth outage, OTEL exporter failing, bull-board inaccessible, high error rate, and slow checkout — each using a Trigger → Symptoms → Triage → Resolution → Escalation template
  2. Operator gets a pre-built Grafana alert rule YAML plus Sentry alert config templates importable into their tooling, with a `runbook_url` annotation on every rule linking to the matching `docs/runbooks/*.md` file
  3. Developer sees an observability concepts doc at `docs/observability/` covering the attributes glossary (which go on spans/logs vs metrics), the cardinality guide, and the trace-propagation flow (API → DB → enqueue → worker)
  4. Operator sees alerts designed with SLO-based burn-rate thresholds and `for: 5m` minimums so deploy rollouts and warmup periods do not fire, with runbook links living in-repo so CI fails if a `runbook_url` points to a missing file
**Plans**: 5 plans
- [x] 23-01-PLAN.md — Validator extension + workflow + package.json wiring + Wave-0 test scaffolds
- [x] 23-02-PLAN.md — Observability concept docs (4 files) + Mermaid floor bump 8 to 11
- [x] 23-03-PLAN.md — 9 incident runbooks under docs/runbooks/
- [x] 23-04-PLAN.md — 9 Sentry alert JSON templates + sentry README
- [ ] 23-05-PLAN.md — docs README index update + final smoke-test PR

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Core Infrastructure | v1.0 | 3/3 | Complete | 2026-04-06 |
| 2. Auth & Multitenancy | v1.0 | 3/3 | Complete | 2026-04-06 |
| 3. Billing & Background Jobs | v1.0 | 4/4 | Complete | 2026-04-07 |
| 4. Frontend Applications | v1.0 | 3/3 | Complete | 2026-04-07 |
| 5. Production Hardening | v1.0 | 2/2 | Complete | 2026-04-08 |
| 6. Responsive Layouts | v1.1 | 3/3 | Complete | 2026-04-08 |
| 7. Accessibility | v1.1 | 4/4 | Complete | 2026-04-09 |
| 8. Internationalization | v1.1 | 3/3 | Complete | 2026-04-09 |
| 9. Team Invites | v1.1 | 5/5 | Complete | 2026-04-11 |
| 10. Payment Abstraction | v1.1 | 4/4 | Complete | 2026-04-11 |
| 11. Accessibility Gap Closure | v1.1 | 2/2 | Complete | 2026-04-14 |
| 12. i18n Hardcoded String Cleanup | v1.1 | 3/3 | Complete | 2026-04-14 |
| 13. JSDoc Annotations | v1.2 | 4/4 | Complete | 2026-04-16 |
| 14. Unit Tests | v1.2 | 6/6 | Complete | 2026-04-17 |
| 15. Developer Documentation | v1.2 | 6/6 | Complete | 2026-04-18 |
| 16. v1.2 Content Drift Fixes | v1.2 | 3/3 | Complete | 2026-04-19 |
| 17. Observability Ports & OTEL Bootstrap | v1.3 | 5/5 | Complete | 2026-04-22 |
| 18. Error Tracking Adapters | v1.3 | 7/7 | Complete | 2026-04-23 |
| 19. Context, Logging & HTTP/CQRS Tracing | v1.3 | 8/8 | Complete | 2026-04-23 |
| 20. BullMQ Trace Propagation | v1.3 | 3/3 | Complete    | 2026-04-26 |
| 20.1. Close v1.3 milestone gaps from observability UAT | v1.3 | 4/4 | Complete    | 2026-04-27 |
| 21. OTEL Adapters + Grafana Observability Stack | v1.3 | 0/0 | Deferred to v1.4+ (Sentry SaaS) | - |
| 22. Admin Ops Tooling | v1.3 | 6/6 | Complete   | 2026-04-27 |
| 23. Runbooks, Alert Templates & Observability Docs | v1.3 | 4/5 | In Progress|  |
