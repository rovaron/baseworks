# Project Research Summary

**Project:** Baseworks v1.2 Documentation & Quality
**Domain:** Developer documentation, JSDoc annotations, and unit testing for a TypeScript monorepo SaaS starter kit
**Researched:** 2026-04-16
**Confidence:** HIGH

## Executive Summary

Baseworks v1.2 is additive quality work on an existing 156-file codebase: JSDoc annotations, unit tests for ~25 CQRS handlers, and developer documentation in a new `docs/` directory. The phase order is non-negotiable -- JSDoc before tests before docs -- because each phase depends on the previous. The primary risk is execution quality: style guides for JSDoc, test runner boundaries, and a documentation-references-code policy must be established before volume work begins, or the milestone produces noise instead of value.

## Key Findings

### Stack Additions

Deliberately minimal -- no changes to existing stack:
- `typedoc ^0.28` + `typedoc-plugin-markdown ^4.0` -- API docs generation from JSDoc with monorepo support
- `@electric-sql/pglite ^0.4` -- In-process WASM PostgreSQL for backend tests (~50ms startup, no Docker)
- `@vitest/coverage-v8 ^4.0` -- Frontend coverage (30x faster than istanbul)
- `ioredis-mock ^8.0` -- In-memory Redis mock for BullMQ unit tests

**What NOT to add:** eslint-plugin-jsdoc (reintroduces ESLint), Docusaurus/VitePress (overkill), Storybook, Testcontainers, snapshot tests.

### Feature Table Stakes

**JSDoc:**
- All exported types/interfaces (packages/shared, ports, schema)
- All CQRS handlers (~25 across auth and billing)
- Core infrastructure (CqrsBus, EventBus, ModuleRegistry, middleware)
- `@example` blocks on 10-15 most-called functions

**Unit Tests:**
- Auth handlers (8 commands + 6 queries) -- zero handler-level unit tests today
- Billing handlers (6 commands + 2 queries) -- money path
- Stripe adapter conformance parity with existing Pagar.me adapter test
- Core infrastructure edge cases

**Documentation:**
- Getting Started guide
- Architecture Overview with Mermaid diagrams
- "Add a Module" tutorial (unique differentiator)
- Configuration guide (env vars, module config, provider selection)
- Testing guide

### Architecture

- Co-located `__tests__/` pattern preserved; handler unit tests in `commands/__tests__/` and `queries/__tests__/`
- Top-level `docs/` directory for cross-cutting guides
- Two test runners: `bun test` for non-DOM, Vitest for React components -- boundary must be documented
- Bottom-up build order within each phase: packages/shared -> core -> modules -> apps

### Watch Out For

1. **JSDoc restating TypeScript types** -- Document WHY, not WHAT. Use ScopedDb's existing JSDoc as quality template.
2. **Tests mocking all behavior** -- Assert on Result output first. Use PGlite for real database assertions.
3. **Two test runner confusion** -- Boundary is DOM vs non-DOM. Document as decision rule before writing tests.
4. **Documentation staleness** -- Reference code locations, not duplicated content.
5. **Over-documenting trivial code** -- Prioritize by complexity, not file order.

## Roadmap Implications

**3 phases, strict dependency chain:**

1. **JSDoc Annotations** -- Articulate behavior contracts on all public APIs; validate Biome compatibility and establish style guide first. Build order: packages/shared -> packages/db -> core -> modules -> apps.
2. **Unit Tests** -- Verify those contracts with handler-level tests; install PGlite + ioredis-mock; establish test runner boundary rule first. Build order: core -> auth queries -> auth commands -> billing -> Stripe adapter -> scoped-db.
3. **Developer Documentation** -- Write guides referencing now-documented, now-tested codebase. Build order: architecture.md -> getting-started.md -> creating-a-module.md -> configuration.md -> testing.md -> integrations/.

**No phases require `gsd-research-phase`** -- all patterns are established in the existing codebase or well-documented tooling.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All additions additive to validated stack |
| Features | HIGH | Scope grounded in direct codebase analysis (156 files, 29 tests) |
| Architecture | HIGH | Follows established codebase conventions |
| Pitfalls | HIGH | All derived from established anti-patterns |

## Gaps to Validate

- Biome JSDoc formatting on multi-line `@example` blocks (empirical, first task of Phase 1)
- PGlite + Drizzle schema push in tests (validate on first handler test before scaling)
- TypeDoc monorepo output quality with typedoc-plugin-markdown (sample run in Phase 1)

---
*Research completed: 2026-04-16*
*Ready for roadmap: yes*
