# Phase 1: Foundation & Core Infrastructure - Validation

**Generated:** 2026-04-05
**Source:** 01-RESEARCH.md Validation Architecture section

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Bun test runner (built-in) |
| Config file | None needed -- Bun test works with zero config |
| Quick run command | `bun test` |
| Full suite command | `bun test --timeout 30000` |

## Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | Plan |
|--------|----------|-----------|-------------------|------|
| FNDTN-01 | Module registry loads modules from config | unit | `bun test apps/api/src/core/__tests__/registry.test.ts -x` | 01-02 |
| FNDTN-02 | Module declares standard shape | unit | `bun test packages/shared/src/__tests__/module-types.test.ts -x` | 01-02 |
| FNDTN-03 | Command handler processes mutation + emits event | unit | `bun test apps/api/src/core/__tests__/cqrs.test.ts -x` | 01-02 |
| FNDTN-04 | Query handler returns tenant-scoped results | integration | `bun test packages/db/src/__tests__/scoped-db.test.ts -x` | 01-03 |
| FNDTN-05 | Drizzle connects to PostgreSQL with schema | integration | `bun test packages/db/src/__tests__/connection.test.ts -x` | 01-01 |
| FNDTN-06 | Tenant-scoped wrapper filters by tenant_id | integration | `bun test packages/db/src/__tests__/scoped-db.test.ts -x` | 01-03 |
| FNDTN-07 | API and worker entrypoints start with different roles | unit | `bun test apps/api/src/__tests__/entrypoints.test.ts -x` | 01-03 |
| FNDTN-08 | Workspace imports resolve correctly | smoke | `bun test apps/api/src/__tests__/workspace-imports.test.ts -x` | 01-01 |
| FNDTN-09 | Missing env vars crash at startup | unit | `bun test packages/config/src/__tests__/env.test.ts -x` | 01-01 |

## Sampling Rate

- **Per task commit:** `bun test`
- **Per wave merge:** `bun test --timeout 30000`
- **Phase gate:** Full suite green before `/gsd-verify-work`

## Test Files Required

| File | Covers | Created By |
|------|--------|------------|
| `apps/api/src/core/__tests__/registry.test.ts` | FNDTN-01, FNDTN-07 | Plan 01-02 |
| `apps/api/src/core/__tests__/cqrs.test.ts` | FNDTN-03 | Plan 01-02 |
| `packages/db/src/__tests__/connection.test.ts` | FNDTN-05 | Plan 01-01 |
| `packages/db/src/__tests__/scoped-db.test.ts` | FNDTN-04, FNDTN-06 | Plan 01-03 |
| `packages/config/src/__tests__/env.test.ts` | FNDTN-09 | Plan 01-01 |
| `packages/shared/src/__tests__/module-types.test.ts` | FNDTN-02 | Plan 01-02 |
| `apps/api/src/__tests__/workspace-imports.test.ts` | FNDTN-08 | Plan 01-01 |
| `apps/api/src/__tests__/entrypoints.test.ts` | FNDTN-07 | Plan 01-03 |

## Infrastructure Dependencies

| Dependency | Required For | Setup |
|------------|-------------|-------|
| PostgreSQL | Integration tests (FNDTN-04, FNDTN-05, FNDTN-06) | `docker compose up -d postgres` |
| Redis | Not required in Phase 1 (scaffolded only) | Optional |

## Coverage

- **Requirements covered:** 9/9 (100%)
- **Test types:** 5 unit, 3 integration, 1 smoke
- **All automated:** Yes -- every test has a `bun test` command

---
*Validation plan generated: 2026-04-05*
