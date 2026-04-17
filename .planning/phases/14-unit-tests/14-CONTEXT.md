# Phase 14: Unit Tests - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Add unit tests that verify behavior contracts for all CQRS handlers (auth + billing), billing adapters (Stripe at parity with Pagarme), scoped-db edge cases, and core infrastructure edge cases. Establishes a shared mock factory for HandlerContext. Replaces existing registration-only tests with behavioral tests.

</domain>

<decisions>
## Implementation Decisions

### Mock Strategy
- **D-01:** Create a shared `createMockContext()` factory in a test helper file that returns a fully typed HandlerContext with mock db, emit, and session. Each test customizes only what it needs via overrides.
- **D-02:** The mock factory lives in a shared test utilities location accessible to all module test files.

### Test Depth
- **D-03:** Each handler gets ~3 tests: 1 success path + 1-2 key error/validation cases (not-found, unauthorized, invalid input). Target ~70 total handler tests, aiming for 80%+ handler coverage without over-testing trivial branches.
- **D-04:** Core infrastructure and scoped-db edge case tests can go deeper since those are shared foundations.

### Stripe Adapter Parity
- **D-05:** Stripe adapter tests mirror the exact structure and test cases of `pagarme-adapter.test.ts`, adapted for Stripe API shapes. Same PaymentProvider contract verification, easy to diff for coverage gaps.

### Test Organization
- **D-06:** One test file per handler (e.g., `create-tenant.test.ts`, `accept-invitation.test.ts`). Maximum isolation and discoverability, even though it means 22+ new files.
- **D-07:** Adapter tests keep their own files (already: `pagarme-adapter.test.ts`, new: `stripe-adapter.test.ts`).

### Existing Test Handling
- **D-08:** Replace existing registration-style tests (e.g., "module has create-tenant command") with behavioral tests. Registration is implicitly verified when the handler test imports and calls successfully. Delete the old registration-only test files to avoid maintaining two test layers.

### Claude's Discretion
- Test data factory design (createTestTenant, createTestUser helpers — build if needed)
- Result assertion helpers (assertResultOk/assertResultErr — build if pattern repeats enough)
- Exact mock shapes for external dependencies (Stripe SDK, better-auth session)
- Whether to extract common mock.module() setup into a shared fixture

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing test patterns
- `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` — Reference for adapter conformance test structure; Stripe tests must mirror this
- `packages/modules/billing/src/__tests__/billing.test.ts` — Reference for bun:mock module mocking pattern (config, stripe, ioredis, bullmq, postgres)
- `packages/modules/auth/src/__tests__/tenant-crud.test.ts` — Current registration-style tests to be replaced
- `packages/modules/auth/src/__tests__/invitation.test.ts` — Current invitation registration tests to be replaced

### Handler source files (test targets)
- `packages/modules/auth/src/commands/*.ts` — 8 auth command handlers
- `packages/modules/auth/src/queries/*.ts` — 6 auth query handlers
- `packages/modules/billing/src/commands/*.ts` — 6 billing command handlers
- `packages/modules/billing/src/queries/*.ts` — 2 billing query handlers
- `packages/modules/billing/src/adapters/stripe/stripe-adapter.ts` — Stripe adapter to test

### Core infrastructure test targets
- `apps/api/src/core/__tests__/cqrs.test.ts` — Existing CQRS bus tests to expand
- `apps/api/src/core/__tests__/event-bus.test.ts` — Existing event bus tests to expand
- `apps/api/src/core/__tests__/registry.test.ts` — Existing registry tests to expand
- `packages/db/src/__tests__/scoped-db.test.ts` — Existing scoped-db tests to expand

### JSDoc style guide
- `docs/jsdoc-style-guide.md` — Phase 13 output; test descriptions should match technical-precise tone

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `bun:test` and `bun:mock` — Test runner and mocking already established across 20 test files
- `mock.module()` pattern — Proven approach for mocking @baseworks/config, stripe, ioredis, bullmq, postgres
- `pagarme-adapter.test.ts` — Complete adapter conformance test to mirror for Stripe

### Established Patterns
- All handlers use `defineCommand`/`defineQuery` factory with schema validation via Zod
- Handlers receive `HandlerContext` with `{ db, emit, tenantId, userId }` shape
- Commands return `Result<T>` (ok/err pattern from packages/shared)
- Tests use `bun:test` describe/test/expect with `bun:mock` for module mocking
- Mock setup happens at file top level before dynamic imports

### Integration Points
- Handler tests need to mock: db queries (drizzle), emit (event bus), session (better-auth)
- Billing handler tests additionally need: PaymentProvider mock
- Scoped-db tests need: postgres driver mock or real test DB

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-unit-tests*
*Context gathered: 2026-04-16*
