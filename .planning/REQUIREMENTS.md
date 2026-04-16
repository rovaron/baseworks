# Requirements: Baseworks

**Defined:** 2026-04-16
**Core Value:** Clone, configure, and start building a multitenant SaaS in minutes -- not weeks.

## v1.2 Requirements

Requirements for Documentation & Quality milestone. Each maps to roadmap phases.

### JSDoc Annotations

- [ ] **JSDOC-01**: All exported types and interfaces have comprehensive JSDoc (packages/shared, module ports, db schema)
- [ ] **JSDOC-02**: All CQRS command handlers have standardized JSDoc (purpose, params, returns, events emitted)
- [ ] **JSDOC-03**: All CQRS query handlers have standardized JSDoc (purpose, params, returns)
- [ ] **JSDOC-04**: Core infrastructure has method-level JSDoc (CqrsBus, EventBus, ModuleRegistry, middleware)
- [ ] **JSDOC-05**: 10-15 key functions have `@example` blocks with usage examples
- [ ] **JSDOC-06**: JSDoc style guide established with good/bad examples before volume work begins

### Unit Tests

- [ ] **TEST-01**: Auth command handler unit tests (8 handlers: create-tenant, update-tenant, delete-tenant, update-profile, create-invitation, accept-invitation, cancel-invitation, reject-invitation)
- [ ] **TEST-02**: Auth query handler unit tests (6 handlers: get-tenant, list-tenants, get-profile, list-members, get-invitation, list-invitations)
- [ ] **TEST-03**: Billing command handler unit tests (6 handlers: create-checkout, create-one-time, cancel-subscription, change-subscription, create-portal, record-usage)
- [ ] **TEST-04**: Billing query handler unit tests (2 handlers: get-subscription-status, get-billing-history)
- [ ] **TEST-05**: Stripe adapter conformance test parity with existing Pagar.me adapter test
- [ ] **TEST-06**: Scoped-db edge case tests (cross-tenant prevention, empty tenant handling)
- [ ] **TEST-07**: Core infrastructure test expansion (registry, CQRS bus, event bus edge cases)
- [ ] **TEST-08**: Config/env validation tests (packages/config validation logic)

### Developer Documentation

- [ ] **DOCS-01**: Getting Started guide (prerequisites, install, env setup, run dev, run tests)
- [ ] **DOCS-02**: Architecture Overview with Mermaid diagrams (module system, CQRS flow, request lifecycle, tenant scoping)
- [ ] **DOCS-03**: "Add a Module" step-by-step tutorial using example module as reference
- [ ] **DOCS-04**: Configuration guide (env vars, module config, provider selection, deployment config)
- [ ] **DOCS-05**: Testing guide (test runner split, mock patterns for HandlerContext, how to test commands/queries)
- [ ] **DOCS-06**: Integration doc: better-auth setup and customization
- [ ] **DOCS-07**: Integration doc: Stripe/Pagar.me billing configuration and adding providers
- [ ] **DOCS-08**: Integration doc: BullMQ queue setup and adding new job types
- [ ] **DOCS-09**: Integration doc: Email templates with Resend and React Email

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### API Reference

- **APIDOC-01**: TypeDoc auto-generated API reference from JSDoc annotations
- **APIDOC-02**: TypeDoc monorepo configuration with per-package output

### End-to-End Tests

- **E2E-01**: Playwright E2E test infrastructure (test DB, test Redis, test server)
- **E2E-02**: Auth flow E2E tests (signup, login, password reset, OAuth)
- **E2E-03**: Billing flow E2E tests (checkout, subscription management)

### Community

- **COMM-01**: Contributing guide with PR template and code review checklist
- **COMM-02**: Changelog and migration guide between versions

## Out of Scope

| Feature | Reason |
|---------|--------|
| 100% test coverage target | Drives writing tests for trivial code; aim for 80%+ on handlers/core instead |
| Storybook for UI components | shadcn components are documented upstream; adds significant tooling overhead |
| External documentation site (Docusaurus/VitePress) | In-repo markdown is sufficient; no hosting/deployment needed |
| Snapshot tests for UI components | Break on any change; a11y tests + visual review are better for shadcn components |
| Video tutorials | High production cost, impossible to update when code changes |
| JSDoc on standard shadcn components | Documented upstream; would add noise |
| E2E tests | Requires separate infrastructure; different milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| JSDOC-01 | — | Pending |
| JSDOC-02 | — | Pending |
| JSDOC-03 | — | Pending |
| JSDOC-04 | — | Pending |
| JSDOC-05 | — | Pending |
| JSDOC-06 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |
| TEST-04 | — | Pending |
| TEST-05 | — | Pending |
| TEST-06 | — | Pending |
| TEST-07 | — | Pending |
| TEST-08 | — | Pending |
| DOCS-01 | — | Pending |
| DOCS-02 | — | Pending |
| DOCS-03 | — | Pending |
| DOCS-04 | — | Pending |
| DOCS-05 | — | Pending |
| DOCS-06 | — | Pending |
| DOCS-07 | — | Pending |
| DOCS-08 | — | Pending |
| DOCS-09 | — | Pending |

**Coverage:**
- v1.2 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️

---
*Requirements defined: 2026-04-16*
*Last updated: 2026-04-16 after initial definition*
