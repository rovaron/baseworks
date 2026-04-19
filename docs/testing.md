# Testing

This document covers the test runner, `HandlerContext` mocks, and the patterns for testing commands, queries, adapters, and job handlers. All current backend tests run under `bun test`; React component tests via Vitest are planned for a future phase.

---

## Test runner

`bun test` auto-discovers every `*.test.ts` and `*.test.tsx` file across the monorepo. No configuration file is required — no `bunfig.toml`, no `vitest.config.*`. Tests run in Bun's runtime, which is the same runtime that serves the API and runs the worker, so there are no transpilation differences between test and production code. The Phase 14 suite of 126 backend tests exercises every module handler, the billing adapters, and the CQRS bus under this single runner.

### Frontend tests (deferred)

React component tests will use Vitest with Testing Library; the integration is deferred to a future phase. When it lands, frontend tests will run under `vitest` while backend tests remain under `bun test`. No `vitest.config.*` file exists in the repo today.

## Shared test utilities

Phase 14 added a shared test-utils directory at `packages/modules/__test-utils__/` that exports mock factories and assertion helpers used across every backend test file. Import these helpers via the relative-path convention: `../../../__test-utils__/mock-context` and `../../../__test-utils__/assert-result` from a module test file at `packages/modules/{module}/src/__tests__/*`. The shared directory is NOT a workspace package; it has no `@baseworks`-prefixed package name and must be consumed by relative paths only.

### createMockContext

`packages/modules/__test-utils__/mock-context.ts::createMockContext` returns a fully typed `HandlerContext` with sensible test defaults. Pass an `overrides` object to customize specific fields per test.

```typescript
// From packages/modules/__test-utils__/mock-context.ts::createMockContext
export function createMockContext(overrides?: Partial<HandlerContext>): HandlerContext {
  return {
    tenantId: "test-tenant-id",
    userId: "test-user-id",
    db: createMockDb(),
    emit: mock(() => {}),
    enqueue: mock(() => Promise.resolve()),
    ...overrides,
  };
}
```

### createMockDb

`packages/modules/__test-utils__/mock-context.ts::createMockDb` returns a chainable stub matching the **raw Drizzle query-builder shape** — `select().from().where().limit()`, `insert().values()`, `update().set()`, and `delete()`. This is the shape handlers like `packages/modules/billing/src/commands/cancel-subscription.ts:29-33` use when they reach for chained Drizzle calls. Override resolved values per method with the options object `{ insert, select, update, delete }`. Each returned mock function is a Bun `mock(...)`, so tests can assert call arguments with `toHaveBeenCalledWith`.

Note that `ScopedDb.select(table)` (declared in `packages/db/src/helpers/scoped-db.ts`, used by `packages/modules/example/src/queries/list-examples.ts:20` as `ctx.db.select(examples)`) is a different, one-shot shape: it takes a table and returns results directly, with no `.from().where().limit()` chain. When testing a handler that uses the one-shot form, override the mock's `select` to accept a table and return the rows directly, or replace `ctx.db` wholesale with a minimal object implementing just the one-shot call.

### assertResultOk / assertResultErr

`packages/modules/__test-utils__/assert-result.ts` exports two helpers for `Result<T>` assertions. `assertResultOk(result)` throws if the result is a failure and returns the unwrapped `data` so callers can inspect it directly. `assertResultErr(result, substring?)` throws if the result is a success, and when the optional substring is passed, also asserts the error message contains it.

## Testing commands and queries

Commands and queries are pure functions of `(input, ctx)`. Tests build a fake `HandlerContext` and assert on the returned `Result<T>` plus observed side effects on `ctx.emit` and `ctx.enqueue`. Because the handlers import only from `@baseworks/shared` and `@baseworks/db`, no `mock.module` block is needed at the top of the test file.

```typescript
// Typical command test — no mock.module block needed when the handler
// only imports from @baseworks/shared and @baseworks/db.
import { describe, test, expect } from "bun:test";
import { createExample } from "../commands/create-example";
import { createMockContext, createMockDb } from "../../../__test-utils__/mock-context";
import { assertResultOk } from "../../../__test-utils__/assert-result";

test("createExample inserts and emits", async () => {
  const ctx = createMockContext({ db: createMockDb({ insert: [{ id: "x-1" }] }) });
  const result = await createExample({ title: "Hi" }, ctx);
  assertResultOk(result);
  expect(ctx.emit).toHaveBeenCalledWith("example.created", expect.any(Object));
});
```

### Behavioral assertions

Assert OBSERVABLE outcomes — the shape of the returned `Result<T>`, the arguments passed to `ctx.emit`, and the arguments passed to `ctx.enqueue`. Do not assert that a specific Drizzle query-builder method was called with a specific argument object — that couples the test to the ORM's internals and breaks on version bumps. Phase 14's test conventions explicitly banned over-specific ORM assertions; DOCS-05 preserves that rule.

## Testing adapters and handlers that import external SDKs

Handlers that import `@baseworks/config`, `postgres`, `stripe`, `ioredis`, or `bullmq` at the module-top level cannot rely on `createMockContext` alone — the imports run at module-load time and would crash without real env values or live connections. Use Bun's `mock.module(...)` to replace those imports at the test file's top, above any `import` of the subject under test.

```typescript
// From packages/modules/billing/src/__tests__/billing.test.ts:1-56 — cite, do not inline in full
mock.module("@baseworks/config", () => ({
  env: { DATABASE_URL: "postgres://test", /* ... */ },
  assertRedisUrl: (_role, url) => url as string,
}));
mock.module("ioredis", () => ({ default: class { quit = mock(() => Promise.resolve("OK")); status = "ready"; } }));
mock.module("bullmq", () => ({ Queue: class {}, Worker: class {} }));
mock.module("postgres", () => ({ default: () => ({}) }));
```

This pattern is the convention for any test whose subject under test imports a real backing service at module load. The full block is in `packages/modules/billing/src/__tests__/billing.test.ts:1-67`; mirror its ordering (config first, then Redis, then BullMQ, then Postgres) so later mocks do not re-trigger validation in already-mocked modules.

### Adapter conformance tests

Adapter tests mock the upstream SDK (e.g., Stripe, Pagar.me) and assert that the port implementation correctly translates Baseworks `PaymentProvider` calls into SDK calls. `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` is the reference template — each test constructs the adapter with a mocked SDK client, invokes a `PaymentProvider` method, and asserts the SDK was called with the expected translated shape.

## Testing job handlers

BullMQ job handlers have signature `(data: unknown) => Promise<void>`. Test them by calling the function directly with sample payload data; assert that it resolves without throwing and — if the handler has observable side effects such as logging or a DB write — assert those with `spyOn` or `mock`.

```typescript
// Typical job handler test
import { describe, test, expect, spyOn } from "bun:test";
import { processFollowup } from "../jobs/process-followup";

test("processFollowup resolves on valid payload", async () => {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  await expect(processFollowup({ exampleId: "ex-1", tenantId: "t-1" })).resolves.toBeUndefined();
  logSpy.mockRestore();
});
```

## Coverage philosophy

The project targets 80%+ coverage on handlers and core infrastructure, not 100%. Handlers are the business-logic surface; pursuing 100% drives tests for trivial code (barrel re-exports, type-only modules, `index.ts` files with a single `export default`) and generates maintenance noise without catching bugs. `.planning/REQUIREMENTS.md` §"Out of Scope" explicitly rejects the 100% target.

## Common mistakes

- Forgetting `mock.module("@baseworks/config", ...)` when the subject under test imports `env` — the test crashes with a Zod validation error at module load rather than failing a clean assertion.
- Over-asserting on ORM call shape (`expect(ctx.db.insert).toHaveBeenCalledWith(examples)`) — couples the test to Drizzle. Assert on the returned `Result<T>` and on the emit / enqueue mocks instead.
- Returning a resolved `Promise` from a `mock(() => ...)` when the real method is synchronous — causes spurious `await` mismatches. Match the real signature.
- Using a real `DATABASE_URL` that happens to be reachable from the test machine — slow, flaky, leaks state between runs. Always mock.

## Next steps

- [Add a module](./add-a-module.md) — where handler tests fit into the module-creation flow.
- [Configuration](./configuration.md) — the env vars that `mock.module("@baseworks/config", ...)` must provide.
- [better-auth integration](./integrations/better-auth.md) — adapter-test patterns for auth flows.
