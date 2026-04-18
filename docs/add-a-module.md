# Add a Module

This tutorial walks through creating a new module by copying and renaming `packages/modules/example`. The example module exercises all four module surfaces — command, query, domain event, BullMQ job — and remains runnable and typechecked, so the tutorial stays in sync with the code.

This tutorial assumes you have read [Architecture Overview](./architecture.md). CQRS, `ModuleRegistry`, `TypedEventBus`, and `scopedDb` are concepts documented there and are not re-explained below.

---

## What you will build

A module contributes up to four observable surfaces plus its HTTP routes: one CRUD command that inserts a tenant-scoped row and emits a domain event, one list query that reads through `scopedDb`, one emitted event string declared in the `ModuleDefinition`, and one BullMQ worker job triggered by the event through a hook file. `packages/modules/example/src/index.ts` is the canonical four-surface shape this tutorial reproduces under a new name.

## Step 1: Copy the example module

```bash
cp -r packages/modules/example packages/modules/{your-module}
```

Rename the directory, then update `packages/modules/{your-module}/package.json` — set `name` to `@baseworks/module-{your-module}` following the existing workspace-package naming convention. Run `bun install` at the repo root so Bun refreshes the workspace symlinks for the new package.

## Step 2: Define the data shape

Add a Drizzle table in `packages/db/src/schema/{your-module}.ts` following the pattern of `packages/db/src/schema/example.ts`. Every tenant-scoped table requires a `tenantId: uuid("tenant_id")` column. Export the table from `packages/db/src/index.ts` so module code can `import { yourTable } from "@baseworks/db"`. Run `bun db:generate` to produce the migration SQL.

The scoped database in `packages/db/src/helpers/scoped-db.ts::injectTenantId` auto-injects `tenant_id` on insert and auto-applies `WHERE tenant_id = ?` on select, update, and delete. No handler code references `tenantId` manually.

## Step 3: Write a command

```typescript
// From packages/modules/example/src/commands/create-example.ts:22-34
export const createExample = defineCommand(CreateExampleInput, async (input, ctx) => {
  const [result] = await ctx.db
    .insert(examples)
    .values({ title: input.title, description: input.description ?? null });
  ctx.emit("example.created", { id: result.id, tenantId: ctx.tenantId });
  return ok(result);
});
```

`defineCommand` takes a TypeBox input schema and an async handler. `ctx.db` is the tenant-scoped database, `ctx.emit` publishes a domain event through `TypedEventBus`, and the return type is `Result<T>` produced by `ok(...)` or `err(...)`. Jobs are dispatched separately through a hook file (see Step 6) rather than through an `enqueue` parameter on the context.

## Step 4: Write a query

```typescript
// From packages/modules/example/src/queries/list-examples.ts:19-24
export const listExamples = defineQuery(ListExamplesInput, async (_input, ctx) => {
  const results = await ctx.db.select(examples);
  return ok(results);
});
```

Queries have no side effects, return `Result<T[]>`, and automatically filter by `tenant_id` via `scopedDb.select`. The input schema may be an empty `Type.Object({})` when no parameters are needed.

## Step 5: Declare an event

Add the event string to the `events: []` array in `index.ts`. The command handler calls `ctx.emit(eventName, payload)`. Declaration-merging for strongly typed event payloads lives in `packages/shared/src/types/events.ts`; extend the `DomainEvents` interface there when the payload shape needs to be shared across modules.

```typescript
// From packages/modules/example/src/index.ts — post-Plan-02
events: ["example.created"],
```

## Step 6: Write a BullMQ job handler

```typescript
// From packages/modules/example/src/jobs/process-followup.ts
export async function processFollowup(data: unknown): Promise<void> {
  const payload = data as { exampleId: string; tenantId: string };
  // Handler logic here. Throw on transient failure to trigger BullMQ retry.
}
```

Handler signature is `(data: unknown) => Promise<void>`. Thrown errors trigger the default BullMQ retry policy (3 attempts with exponential backoff; see `packages/queue/src/index.ts::createQueue (defaultJobOptions)`). Workers are auto-started by `apps/api/src/worker.ts:32-77` for every entry in `def.jobs` of every loaded module — no manual worker registration. The enqueue side is wired separately through an event-bus hook; see `packages/modules/example/src/hooks/on-example-created.ts::registerExampleHooks` for the pattern that subscribes to the domain event and calls `queue.add` on a lazily initialized BullMQ queue.

## Step 7: Register surfaces in the module definition

```typescript
// From packages/modules/example/src/index.ts — full four-surface shape (12 lines;
// exceeds the 10-line inline-snippet guideline because this is the canonical composition)
export default {
  name: "example",
  routes: exampleRoutes,
  commands: { "example:create": createExample },
  queries: { "example:list": listExamples },
  jobs: {
    "example:process-followup": {
      queue: "example:process-followup",
      handler: processFollowup,
    },
  },
  events: ["example.created"],
} satisfies ModuleDefinition;
```

## Step 8: Mount routes

Export an Elysia plugin from `routes.ts` that consumes `handlerCtx` from the tenant-middleware derive step (see [Architecture Overview](./architecture.md) §"Request lifecycle"). The routes file returns a new `Elysia({ prefix: "/{your-module}" })` chain with `.post`, `.get`, and so on, each handler calling the corresponding command or query with `body` / `query` and `handlerCtx`. Cite `packages/modules/example/src/routes.ts` for the full pattern.

## Step 9: Register the module

### Static import map

Add an entry in `apps/api/src/core/registry.ts::moduleImportMap`:

```typescript
// apps/api/src/core/registry.ts — add to moduleImportMap
"{your-module}": () => import("@baseworks/module-{your-module}"),
```

### API and worker entrypoints

Add the module name to the `modules` array in both `apps/api/src/index.ts:25-28` and `apps/api/src/worker.ts:21-24`. Both arrays drive `ModuleRegistry.loadAll`; omitting a name in one place means the module is not loaded in that role. If the module emits events that enqueue jobs, also re-export a `register{YourModule}Hooks` function from the module's `index.ts` and invoke it in `apps/api/src/index.ts` alongside `registerBillingHooks` and `registerExampleHooks`.

### Workspaces

Ensure your new module's directory is covered by the root `package.json` `workspaces: ["packages/modules/*"]` glob — no action needed for modules added under that path.

## Step 10: Test it

Use the Phase 14 test utilities — `createMockContext()` imported via the relative path `../../../__test-utils__/mock-context` and `assertResultOk` / `assertResultErr` from `../../../__test-utils__/assert-result`. The project convention is to import these helpers by relative path from each module's `src/__tests__/` directory; the shared directory is NOT a workspace package and has no `@baseworks`-prefixed package name. Cite [testing.md](./testing.md) for the full testing guide.

```typescript
import { describe, test, expect } from "bun:test";
import { createExample } from "../commands/create-example";
import { createMockContext, createMockDb } from "../../../__test-utils__/mock-context";
import { assertResultOk } from "../../../__test-utils__/assert-result";

test("inserts and emits event", async () => {
  const ctx = createMockContext({ db: createMockDb({ insert: [{ id: "ex-1" }] }) });
  const result = await createExample({ title: "Hi" }, ctx);
  assertResultOk(result);
  expect(ctx.emit).toHaveBeenCalledWith("example.created", expect.any(Object));
});
```

Link: [Testing guide](./testing.md).

## Smoke test

```bash
bun run typecheck
```

```bash
bun test packages/modules/{your-module}
```

```bash
bun api
# then: curl -X POST http://localhost:3000/api/{your-module} ...
```

Once the three succeed, the module is wired end-to-end — `CqrsBus` dispatches commands and queries, the worker picks up jobs from Redis, and events fan out through `TypedEventBus`.

## Security checklist

- Commands and queries use `ctx.db` (the scoped database). Never import `createDb(env.DATABASE_URL)` or `unscoped-db.ts` from a module handler.
- Every input is validated via `defineCommand(Schema, ...)` / `defineQuery(Schema, ...)`. No handler accepts `unknown` as its input type.
- BullMQ job handlers receive untrusted serialized data. Validate the payload shape at the top of the handler before acting on it. The handler MUST derive any tenant-scoped DB access from the payload's `tenantId`, not from a global singleton.

## Next steps

- [Configuration](./configuration.md) — register env vars your module needs.
- [Testing](./testing.md) — mock patterns for commands, queries, and adapters.
- [BullMQ integration](./integrations/bullmq.md) — adding a new queue / job type.
