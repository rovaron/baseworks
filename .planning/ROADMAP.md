# Roadmap: Baseworks

## Milestones

- ✅ **v1.0 MVP** -- Phases 1-5 (shipped 2026-04-08)
- ✅ **v1.1 Polish & Extensibility** -- Phases 6-12 (shipped 2026-04-16)
- 🚧 **v1.2 Documentation & Quality** -- Phases 13-15 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) -- SHIPPED 2026-04-08</summary>

- [x] Phase 1: Foundation & Core Infrastructure (3/3 plans) -- completed 2026-04-06
- [x] Phase 2: Auth & Multitenancy (3/3 plans) -- completed 2026-04-06
- [x] Phase 3: Billing & Background Jobs (4/4 plans) -- completed 2026-04-07
- [x] Phase 4: Frontend Applications (3/3 plans) -- completed 2026-04-07
- [x] Phase 5: Production Hardening (2/2 plans) -- completed 2026-04-08

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>v1.1 Polish & Extensibility (Phases 6-12) -- SHIPPED 2026-04-16</summary>

- [x] Phase 6: Responsive Layouts (3/3 plans) -- completed 2026-04-08
- [x] Phase 7: Accessibility (4/4 plans) -- completed 2026-04-09
- [x] Phase 8: Internationalization (3/3 plans) -- completed 2026-04-09
- [x] Phase 9: Team Invites (5/5 plans) -- completed 2026-04-11
- [x] Phase 10: Payment Abstraction (4/4 plans) -- completed 2026-04-11
- [x] Phase 11: Accessibility Gap Closure (2/2 plans) -- completed 2026-04-14
- [x] Phase 12: i18n Hardcoded String Cleanup (3/3 plans) -- completed 2026-04-14

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

### 🚧 v1.2 Documentation & Quality (In Progress)

**Milestone Goal:** Annotate the entire codebase with comprehensive JSDoc, increase test coverage with high-quality unit tests, and create in-repo developer documentation covering configuration, testing, and third-party integrations.

- [ ] **Phase 13: JSDoc Annotations** - Establish behavior contracts on all public APIs with standardized JSDoc and a style guide
- [ ] **Phase 14: Unit Tests** - Verify contracts with handler-level tests across auth, billing, core, and adapters
- [ ] **Phase 15: Developer Documentation** - Create in-repo guides referencing the now-documented, now-tested codebase

## Phase Details

### Phase 13: JSDoc Annotations
**Goal**: Every exported function, type, and handler has standardized JSDoc that documents intent and contracts -- not restating TypeScript signatures
**Depends on**: Phase 12 (v1.1 complete)
**Requirements**: JSDOC-01, JSDOC-02, JSDOC-03, JSDOC-04, JSDOC-05, JSDOC-06
**Success Criteria** (what must be TRUE):
  1. A JSDoc style guide exists with good/bad examples and Biome compatibility is validated
  2. All exported types, interfaces, and schemas in packages/shared, packages/db, and module ports have JSDoc describing purpose and constraints
  3. All CQRS command and query handlers have standardized JSDoc documenting purpose, params, returns, and (for commands) events emitted
  4. Core infrastructure methods (CqrsBus, EventBus, ModuleRegistry, middleware) have method-level JSDoc
  5. At least 10 key functions have `@example` blocks demonstrating usage
**Plans:** 1/4 plans executed

Plans:
- [x] 13-01-PLAN.md -- Style guide + packages/shared + packages/db annotations
- [ ] 13-02-PLAN.md -- Auth module handlers and supporting files
- [ ] 13-03-PLAN.md -- Billing module + example module annotations
- [ ] 13-04-PLAN.md -- Core infrastructure (CqrsBus, EventBus, Registry, middleware)

### Phase 14: Unit Tests
**Goal**: CQRS handlers and core infrastructure have unit tests that verify behavior contracts, with test runner boundaries documented and test utilities established
**Depends on**: Phase 13
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08
**Success Criteria** (what must be TRUE):
  1. All 8 auth command handlers have unit tests verifying success paths and error cases
  2. All 6 auth query handlers have unit tests verifying data retrieval and not-found cases
  3. All 6 billing command handlers and 2 billing query handlers have unit tests
  4. Stripe adapter has conformance tests at parity with existing Pagar.me adapter test suite
  5. Scoped-db edge cases (cross-tenant prevention, empty tenant) and core infrastructure edge cases (registry, CQRS bus, event bus) are tested
**Plans**: TBD

### Phase 15: Developer Documentation
**Goal**: A new developer can clone the repo, understand the architecture, run the project, add a module, and configure integrations by reading in-repo documentation alone
**Depends on**: Phase 14
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04, DOCS-05, DOCS-06, DOCS-07, DOCS-08, DOCS-09
**Success Criteria** (what must be TRUE):
  1. A Getting Started guide walks through prerequisites, install, env setup, dev server, and running tests
  2. An Architecture Overview with Mermaid diagrams explains the module system, CQRS flow, request lifecycle, and tenant scoping
  3. An "Add a Module" step-by-step tutorial uses the example module as reference to create a new module from scratch
  4. Configuration and testing guides cover env vars, module config, provider selection, test runner split, mock patterns, and how to test commands/queries
  5. Integration docs for better-auth, Stripe/Pagar.me billing, BullMQ queues, and Resend/React Email each explain setup, customization, and extension points

## Progress

**Execution Order:**
Phases execute in numeric order: 13 -> 14 -> 15

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
| 13. JSDoc Annotations | v1.2 | 1/4 | In Progress|  |
| 14. Unit Tests | v1.2 | 0/0 | Not started | - |
| 15. Developer Documentation | v1.2 | 0/0 | Not started | - |
