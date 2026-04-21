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

## Milestone: v1.2 — Documentation & Quality

**Shipped:** 2026-04-21
**Phases:** 4 (13-16) | **Plans:** 19

### What Was Built
- Comprehensive JSDoc annotations across every exported symbol in packages/shared, packages/db, auth, billing, example module, and core infrastructure — anchored by a canonical style guide at `docs/jsdoc-style-guide.md`
- Unit test coverage for every CQRS handler: 8 auth commands + 6 auth queries + 6 billing commands + 2 billing queries, plus Stripe adapter conformance at parity with Pagar.me and scoped-db edge cases (cross-tenant prevention, empty tenant)
- Canonical `createMockContext` helper unifying test convention across auth handlers (Phase 14 + Phase 16 migration)
- 11 in-repo documentation pages: Getting Started, Architecture Overview (4 Mermaid diagrams), Add-a-Module tutorial, Configuration + Testing guides, integration docs for better-auth, Stripe/Pagar.me, BullMQ, Resend/React Email
- Example module extended (D-05) to demonstrate event emission + BullMQ job handler + Wave 0 tests — the "how to build a module" reference
- `scripts/validate-docs.ts` phase-close validator enforcing forbidden-import, secret-shape, and Mermaid floor invariants
- Two-runner test orchestration — `bun test` (non-DOM) chained to `vitest run` (jsdom) via root `bun run test`

### What Worked
- JSDoc style guide locked in Phase 13-01 before volume annotation — prevented divergent dialects across modules
- Writing the milestone audit BEFORE closing surfaced 6 content-drift gaps in time for a dedicated Phase 16 rather than carrying debt into v1.3
- Choosing docs-first over code-first for content-drift fixes (Phase 16 Option A: revise docs to match live `event-bus-hook` path rather than retrofit `ctx.enqueue`) kept blast radius small
- Debug-session pattern from prior milestones scaled cleanly to the three test-infrastructure bugs surfaced during close — each fix was small, atomic, and well-documented

### What Was Inefficient
- v1.1 milestone section was never added to this retrospective — pattern should be enforced at each close
- Three test-infrastructure bugs (Elysia mount, get-profile pollution, UI runner wiring) all surfaced during milestone close rather than during the phases that introduced them — suggests the phase verification gates should exercise the full `bun test` suite, not just phase-specific tests
- `260420-a4t-PLAN.md` naming convention diverged from what `gsd-tools audit-open` expects (plain `PLAN.md` / `SUMMARY.md`) — forced a rename during close
- Executor leaked file changes from its worktree into main via `node -e fs.writeFileSync` deviation (workaround for a Read-tool cache mismatch with CRLF files) — had to hand-resolve the dirty worktree before merge

### Patterns Established
- JSDoc tag ordering: description, `@param`, `@returns`, `@throws`, `@example`, `@see`, `Per X-YY` citations
- `@warning` tag for security-critical constraints (e.g. bypassing tenant scoping)
- Lazy handler deps via `await import(...)` for any CQRS handler that sits on a module-level singleton — protects against `mock.module()` registering after first import
- Guard eager `.mount()` / side-effect bindings with `typeof x?.method === "function"` to tolerate partial test mocks
- Two-runner test chain: `bun test <non-ui-dirs> && (cd packages/ui && bun run test)` — one command, two environments
- Milestone audit is a gate, not a postscript — run `/gsd:audit-milestone` before `/gsd:complete-milestone`

### Key Lessons
1. **Bun's `mock.module()` is late-bound — handlers that capture deps at module-load time are immune to it.** Resolve deps lazily inside handlers for anything testable, especially when sibling test files load without mocks.
2. **Elysia's `.mount()` does a defensive `path.length` check — passing `undefined` throws an inscrutable TypeError.** Guard the mount site rather than every caller.
3. **Bun's test runner has no DOM — do not let React tests enter its file discovery.** Route them through Vitest+jsdom explicitly; bunfig cannot exclude globs in 1.3.x.
4. **Content drift is invisible to eyeball review at 11-page scale.** Structural validators (`scripts/validate-docs.ts`) make the docs contract enforceable.
5. **"Deferred items" recorded in phase SUMMARY.md files are the next milestone's debt** — surface them in the audit, not just in file comments.

### Cost Observations
- Model mix: Primarily Opus 4.7 for planning + execution, Sonnet for checker/verifier roles
- Sessions: ~6 focused sessions across 6 days
- Notable: Milestone-close bug fixes via `/gsd:debug` spawned isolated investigation contexts, keeping main orchestrator context lean for the close workflow itself

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 15 | Initial project — established all patterns |
| v1.1 | 7 | 24 | Introduced parallel agent execution (worktrees); responsive + a11y + i18n + invites + payment abstraction |
| v1.2 | 4 | 19 | Introduced phase-close validators (`scripts/validate-docs.ts`); introduced two-runner test orchestration (Bun + Vitest); introduced debug-session pattern during milestone close |

### Top Lessons (Verified Across Milestones)

1. Foundation-first ordering pays off — invest in core architecture before feature modules
2. Type-safe end-to-end (Eden Treaty) eliminates entire categories of bugs
3. Reuse framework primitives (better-auth org plugin) over custom implementations
4. Documentation-as-contract — enforce with validators, not reviewers (`scripts/validate-docs.ts`)
5. Late-binding surprises in test infrastructure — Bun's `mock.module()` registry, Elysia's eager `.mount()`, Vite vs Bun DOM support — plan for them by running full `bun test` as a phase verification gate, not just phase-scoped tests
