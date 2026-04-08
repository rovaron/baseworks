# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-08
**Phases:** 5 | **Plans:** 15 | **Tasks:** 41

### What Was Built
- Config-driven module registry with CQRS command/query dispatch and in-process event bus
- Tenant-scoped database wrapper with automatic filtering, better-auth with OAuth/magic links/RBAC
- Stripe billing (subscriptions, one-time, usage-based) with webhook idempotency and BullMQ job processing
- Next.js customer app with auth/billing/tenant-switching and Vite admin dashboard with management panels
- Shared UI package (18 shadcn components, Tailwind 4) and Eden Treaty type-safe API client
- Docker multi-stage builds, Docker Compose orchestration, Vercel config, health checks, pino logging

### What Worked
- Foundation-first phase ordering (registry -> auth -> billing -> frontend -> production) validated well — each phase built cleanly on the previous
- Medusa-style module architecture scaled from example module through auth, billing without refactoring the registry
- Eden Treaty end-to-end type safety eliminated manual type definitions across both frontend apps
- better-auth organization plugin reuse for tenancy avoided duplicating user/org/role schemas
- Static import map for module loading (vs dynamic imports) was the right call for Bun compatibility
- 3-day timeline from project init to shipped v1.0 across 116 commits

### What Was Inefficient
- Requirements checkboxes for phases 3-5 were never updated during execution (bookkeeping gap)
- ROADMAP.md progress table showed Phase 5 as "0/2 Not started" despite both plans being complete
- Some STATE.md fields drifted from actual state (e.g., progress bar showed 67% when actually 100%)
- No milestone audit was run before completion — all verification was retroactive

### Patterns Established
- Module definition contract: routes, commands, queries, jobs, events in a standard ModuleDefinition
- handlerCtx injected via Elysia derive chain (not .state()) for route handlers
- Auth routes mounted before tenant middleware via registry.getAuthRoutes() separation
- Session-derived tenant context (not header-based) for security
- Webhook idempotency via dedup table pattern
- Request ID propagation from API through BullMQ jobs for log correlation

### Key Lessons
1. Keep REQUIREMENTS.md checkboxes in sync during phase execution — don't rely on SUMMARY.md alone
2. STATE.md needs automated updates or it drifts — the manual update model doesn't scale
3. Run `/gsd-audit-milestone` before `/gsd-complete-milestone` — retroactive verification is harder
4. better-auth's organization plugin is powerful but sparsely documented — expect to read source code
5. Elysia type chain requires careful sub-app splitting from day one to avoid inference degradation

### Cost Observations
- Model mix: primarily opus for execution, sonnet for research/planning
- Sessions: ~10-12 sessions across 3 days
- Notable: Parallel agent execution (worktrees) significantly accelerated frontend phase

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 15 | Initial project — established all patterns |

### Top Lessons (Verified Across Milestones)

1. Foundation-first ordering pays off — invest in core architecture before feature modules
2. Type-safe end-to-end (Eden Treaty) eliminates entire categories of bugs
3. Reuse framework primitives (better-auth org plugin) over custom implementations
