# Phase 14: Unit Tests - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 14-unit-tests
**Areas discussed:** Mock strategy, Test depth, Stripe adapter parity, Test organization, Existing test handling

---

## Mock Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Shared mock factory | Create createMockContext() utility with typed HandlerContext, mock db/emit/session. Each test customizes what it needs. | ✓ |
| Per-test inline mocks | Each test file builds its own context object. More explicit, lots of repetition. | |
| Hybrid approach | Shared factory for common shape, handlers with unusual needs build own extension. | |

**User's choice:** Shared mock factory
**Notes:** None

---

## Test Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Success + key errors | 1 success path + 1-2 error cases per handler. ~3 tests each, ~70 total. 80%+ coverage. | ✓ |
| Thorough coverage | Success + all error branches + edge cases. ~5-8 tests per handler, ~150 total. | |
| Minimal smoke tests | One success path per handler only. ~22 tests total. | |

**User's choice:** Success + key errors
**Notes:** None

---

## Stripe Adapter Parity

| Option | Description | Selected |
|--------|-------------|----------|
| Mirrored structure | Same test cases and structure as pagarme-adapter.test.ts, adapted for Stripe API shapes. | ✓ |
| Equivalent coverage, Stripe-specific | Same behavioral coverage but organized around Stripe-specific concepts. | |
| Shared conformance suite | Extract shared test suite parameterized by adapter. More DRY but needs refactoring. | |

**User's choice:** Mirrored structure
**Notes:** None

---

## Test Organization

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by domain | Keep existing grouping pattern, expand with behavioral tests. Fewer files. | |
| One file per handler | create-tenant.test.ts, update-tenant.test.ts, etc. 22+ new files. Maximum isolation. | ✓ |
| Mixed: domain + adapter | Group handlers by domain, give each adapter its own file. | |

**User's choice:** One file per handler
**Notes:** None

---

## Existing Test Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with behavioral | Delete registration checks, replace with handler-level behavioral tests. | ✓ |
| Keep both | Leave registration tests, add behavioral alongside. | |
| Merge into behavioral | Move registration assertion into each handler's behavioral test as first case. | |

**User's choice:** Replace with behavioral
**Notes:** None

---

## Claude's Discretion

- Test data factory design
- Result assertion helpers
- Exact mock shapes for external dependencies
- Whether to extract common mock.module() setup

## Deferred Ideas

None — discussion stayed within phase scope.
