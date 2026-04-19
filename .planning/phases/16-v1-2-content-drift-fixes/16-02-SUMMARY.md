---
phase: 16-v1-2-content-drift-fixes
plan: 02
subsystem: documentation

tags: [documentation, content-drift, v1.2-audit, mermaid, event-bus-hooks, cqrs, bullmq]

# Dependency graph
requires:
  - phase: 15-developer-documentation
    provides: Initial docs/integrations/bullmq.md and docs/architecture.md; validate-docs.ts Mermaid floor + forbidden-import + secret-shape invariants
provides:
  - "docs/integrations/bullmq.md Mermaid diagram + prose describing event-bus-hook enqueue pattern (DOCS-08 FAIL -> PASS)"
  - "docs/architecture.md CQRS-flow Mermaid + HandlerContext clarifier describing hook-based enqueue (DOCS-02 WARN -> PASS)"
  - "Aligned vocabulary across bullmq.md, architecture.md, and add-a-module.md: 'event-bus hook', 'ctx.emit -> hook -> queue.add'"
affects: [16-03-auth-test-convention, future-module-additions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Event-bus-hook canonical enqueue pattern citation (mirror on-example-created.ts + add-a-module.md:40)"

key-files:
  created: []
  modified:
    - docs/integrations/bullmq.md
    - docs/architecture.md

key-decisions:
  - "Option A (revise docs to match live code) over Option B (wire ctx.enqueue at runtime) — sibling doc docs/add-a-module.md:40 already documents hook pattern as canonical; Option B would require runtime change to apps/api/src/index.ts:104-118 and re-verification of all command-handler call sites"

patterns-established:
  - "Enqueue-path citation pattern: bullmq.md and architecture.md both reference packages/modules/example/src/hooks/on-example-created.ts as the canonical event-bus-hook reference implementation"

requirements-completed: [DOCS-02, DOCS-08]

gap_closure: true
closes_gap_from: .planning/v1.2-MILESTONE-AUDIT.md

# Metrics
duration: 3min
completed: 2026-04-19
---

# Phase 16 Plan 02: v1.2 Content Drift Fixes (DOCS-02 + DOCS-08) Summary

**Revised bullmq.md and architecture.md so Mermaid diagrams and prose describe the REAL enqueue path (event-bus-hook via `ctx.emit` -> `queue.add`) instead of the non-existent `ctx.enqueue` call, eliminating the FAIL-2 finding from the v1.2 milestone audit.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-19T21:52:00Z
- **Completed:** 2026-04-19T21:54:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- DOCS-08 closed (FAIL -> PASS): `docs/integrations/bullmq.md` sequenceDiagram now shows `Cmd->>EB: ctx.emit(...)` -> `EB->>Hook: on(...)` -> `Hook->>Q: queue.add(...)`; four prose passages brought into alignment with live code.
- DOCS-02 closed (WARN -> PASS): `docs/architecture.md` CQRS-flow sequenceDiagram no longer contains the fake `Cmd->>Q: ctx.enqueue(...)` arrow; HandlerContext section explains the reserved type slot; request-lifecycle Mermaid node label no longer lists `enqueue`.
- Sibling doc `docs/add-a-module.md:40` untouched — regression-check intact.
- `bun run scripts/validate-docs.ts` still exits 0 (Mermaid floor of 8 held; forbidden-import + secret-shape invariants unchanged).
- Zero code changes; `HandlerContext.enqueue` type slot preserved at `packages/shared/src/types/cqrs.ts:29-30` as future-reserved.

## Task Commits

Each task was committed atomically:

1. **Task 1: DOCS-08 fix — revise bullmq.md Mermaid + prose to event-bus-hook pattern** — `c666a76` (docs)
2. **Task 2: DOCS-02 fix — revise architecture.md CQRS-flow Mermaid + handlerCtx callout** — `f31c43e` (docs)

## Files Created/Modified

- `docs/integrations/bullmq.md` — Mermaid swap + 3 prose edits (gotcha bullet, Extending step 3, Extending step 4)
- `docs/architecture.md` — Mermaid swap + 2 prose edits (HandlerContext clarifier paragraph, Queries-vs-commands prose) + 1 Mermaid node label fix

## Verbatim Before/After Snippets

### bullmq.md — Mermaid fence (lines 70-91 before)

BEFORE:
```
sequenceDiagram
  participant Cmd as Command handler
  participant Q as BullMQ Queue
  participant Redis
  participant W as BullMQ Worker
  participant H as Job handler

  Cmd->>Q: ctx.enqueue("example:process-followup", payload)
  Q->>Redis: persist job
  ...
```

AFTER:
```
sequenceDiagram
  participant Cmd as Command handler
  participant EB as TypedEventBus
  participant Hook as Event-bus hook
  participant Q as BullMQ Queue
  participant Redis
  participant W as BullMQ Worker
  participant H as Job handler

  Cmd->>EB: ctx.emit("example.created", payload)
  EB->>Hook: on("example.created", listener)
  Hook->>Q: queue.add("example:process-followup", payload)
  Q->>Redis: persist job
  ...
```

(Plus a new lead-in prose paragraph inserted BEFORE the fence citing `on-example-created.ts` and `add-a-module.md` §"Step 6".)

### bullmq.md — Gotchas bullet (line 99 before)

BEFORE:
```
- **`ctx.enqueue` is optional.** `HandlerContext.enqueue` is declared as `Promise<void> | undefined`. Test contexts receive a no-op via the mock factory; production command handlers invoke `await ctx.enqueue?.(...)` — the optional chaining preserves type safety if a future context skips queue wiring entirely.
```

AFTER:
```
- **`HandlerContext.enqueue` is declared but not wired at runtime.** The type slot (`packages/shared/src/types/cqrs.ts:29-30`) is reserved for a future direct-enqueue pathway. Today the live API-process derive (`apps/api/src/index.ts:104-118`) populates only `tenantId`, `userId`, `db`, and `emit` — `enqueue` is undefined. `createMockContext` (test utility) provides a `mock(() => Promise.resolve())` stub for convenience, but production command handlers do NOT use the context's `enqueue` field. Enqueue via an event-bus hook instead (see the Mermaid diagram above and `docs/add-a-module.md` §"Step 6").
```

### bullmq.md — Extending step 3 (line 119 before)

BEFORE:
```
3. Ensure your module name is listed in the `modules` array in `apps/api/src/worker.ts:21-24` so the worker process loads it. No separate worker-registration call is required — `apps/api/src/worker.ts:32-77` iterates all `def.jobs` automatically on boot.
```

AFTER:
```
3. Ensure your module name is listed in the `modules` array in BOTH the API entrypoint (`apps/api/src/index.ts:25-28`) and the worker entrypoint (`apps/api/src/worker.ts:21-24`) so both processes load it. No separate worker-registration call is required — `apps/api/src/worker.ts:32-77` iterates all `def.jobs` automatically on boot.
```

### bullmq.md — Extending step 4 (line 120 before)

BEFORE:
```
4. Enqueue from a command handler: `await ctx.enqueue?.("yourmodule:action", payload)`. The enqueue flows through `HandlerContext.enqueue`, which `ModuleRegistry` wires to `createQueue(queueName, redisUrl).add(...)`.
```

AFTER:
```
4. Emit a domain event from the command handler (`ctx.emit("yourmodule.something-happened", payload)`) and add a hook file under `packages/modules/<yourmodule>/src/hooks/` that listens on that event and calls `queue.add(...)` on a lazily-constructed BullMQ queue. Mirror `packages/modules/example/src/hooks/on-example-created.ts` — it memoizes the queue, falls back to a console log when `REDIS_URL` is absent, and swallows listener errors so a failed enqueue does NOT crash the originating command. Register the hook at API startup (call your `registerYourModuleHooks(registry.getEventBus())` alongside the existing `registerExampleHooks(...)` and `registerBillingHooks(...)` calls).
```

### architecture.md — CQRS-flow Mermaid fence (lines 57-74 before)

BEFORE:
```
sequenceDiagram
  participant Route as Elysia route handler
  participant Bus as CqrsBus
  participant Cmd as defineCommand handler
  participant DB as scopedDb
  participant EB as TypedEventBus
  participant Q as BullMQ queue

  Route->>Bus: bus.execute("example:create", input, ctx)
  Bus->>Cmd: handler(input, ctx)
  Cmd->>DB: ctx.db.insert(table).values(...)
  DB-->>Cmd: Result row
  Cmd->>EB: ctx.emit("example.created", payload)
  Cmd->>Q: ctx.enqueue("example:process-followup", payload)
  Cmd-->>Bus: ok(data)
  Bus-->>Route: Result<T>
```

AFTER:
```
sequenceDiagram
  participant Route as Elysia route handler
  participant Bus as CqrsBus
  participant Cmd as defineCommand handler
  participant DB as scopedDb
  participant EB as TypedEventBus
  participant Hook as Event-bus hook
  participant Q as BullMQ queue

  Route->>Bus: bus.execute("example:create", input, ctx)
  Bus->>Cmd: handler(input, ctx)
  Cmd->>DB: ctx.db.insert(table).values(...)
  DB-->>Cmd: Result row
  Cmd->>EB: ctx.emit("example.created", payload)
  Cmd-->>Bus: ok(data)
  Bus-->>Route: Result<T>
  EB->>Hook: on("example.created", listener)
  Hook->>Q: queue.add("example:process-followup", payload)
```

### architecture.md — HandlerContext clarifier paragraph (inserted between code block and §Queries-vs-commands)

BEFORE: No clarifier paragraph; the §Queries-vs-commands paragraph claimed commands "emit events through `ctx.emit` and enqueue jobs".

AFTER (new paragraph inserted):
```
The `enqueue` field is declared optional and is NOT populated by the live API derive at `apps/api/src/index.ts:104-118` (only `tenantId`, `userId`, `db`, and `emit` are present at runtime). It is a reserved type slot for a future direct-enqueue pathway. Today, command handlers emit a domain event and a module-owned hook on the event bus performs the actual `queue.add(...)` — see `docs/integrations/bullmq.md` §"Wiring in Baseworks" and `packages/modules/example/src/hooks/on-example-created.ts` for the reference implementation.
```

### architecture.md — Queries-vs-commands prose

BEFORE:
```
Commands may emit events through `ctx.emit` and enqueue jobs; queries have no side effects.
```

AFTER:
```
Commands may emit events through `ctx.emit` and — indirectly, via an event-bus hook listening on that event — trigger BullMQ enqueues; queries have no side effects.
```

### architecture.md — Request-lifecycle Mermaid node label (line 107 before)

BEFORE:
```
  TM --> DV[derive handlerCtx<br/>tenantId, userId, db, emit, enqueue]
```

AFTER:
```
  TM --> DV[derive handlerCtx<br/>tenantId, userId, db, emit]
```

## Verification Results

All acceptance-criteria grep invariants from the plan hold:

- `grep -c "ctx.enqueue" docs/integrations/bullmq.md docs/architecture.md` -> `0` and `0`
- `grep -c "on-example-created" docs/integrations/bullmq.md` -> `2` (prose cite + numbered-list cite)
- `grep -c "on-example-created" docs/architecture.md` -> `1`
- `grep -c "Event-bus hook" docs/integrations/bullmq.md` -> `1` (Mermaid participant)
- `grep -c "Event-bus hook" docs/architecture.md` -> `1` (Mermaid participant)
- `grep -c "TypedEventBus" docs/integrations/bullmq.md` -> `1`
- `grep -c "declared but not wired" docs/integrations/bullmq.md` -> `1`
- `grep -c "apps/api/src/index.ts:104-118" docs/integrations/bullmq.md` -> `1`
- `grep -c 'ctx.emit("yourmodule' docs/integrations/bullmq.md` -> `1`
- `grep -c 'apps/api/src/index.ts:25-28' docs/integrations/bullmq.md` -> `1` (updated Extending step 3)
- `grep -c 'tenantId, userId, db, emit, enqueue' docs/architecture.md` -> `0` (old derive bracket label gone)
- `grep -c 'tenantId, userId, db, emit\]' docs/architecture.md` -> `1` (new derive bracket label present)
- `grep -c "reserved type slot" docs/architecture.md` -> `1`
- `grep -c "indirectly, via an event-bus hook" docs/architecture.md` -> `1`
- `grep -c 'Cmd->>Q: ctx.enqueue' docs/architecture.md` -> `0`
- `grep -c 'Hook->>Q: queue.add' docs/architecture.md` -> `1`
- `bun run scripts/validate-docs.ts` exits 0 (Mermaid floor of 8 met; forbidden-import + secret-shape invariants held)
- `docs/add-a-module.md:40` sibling text unchanged (regression-check passes):
  > `defineCommand` takes a TypeBox input schema and an async handler. `ctx.db` is the tenant-scoped database, `ctx.emit` publishes a domain event through `TypedEventBus`, and the return type is `Result<T>` produced by `ok(...)` or `err(...)`. Jobs are dispatched separately through a hook file (see Step 6) rather than through an `enqueue` parameter on the context.

## Decisions Made

- **Option A (revise docs to match live code), not Option B (wire `ctx.enqueue` at runtime).** Rationale: sibling doc `docs/add-a-module.md:40` already documents the event-bus-hook pattern as canonical; Option B would require modifying `apps/api/src/index.ts:104-118` (adding `enqueue` wiring into the derive) plus re-verifying every command-handler call site to confirm none assumes the runtime shape. Plan-level decision recorded in objective.

## Deviations from Plan

None — plan executed exactly as written. All four edits to `docs/integrations/bullmq.md` and all three edits to `docs/architecture.md` applied verbatim per plan spec. Every acceptance-criterion grep invariant holds. `bun run scripts/validate-docs.ts` still exits 0. `docs/add-a-module.md:40` sibling text is byte-identical to pre-plan state.

## Issues Encountered

None.

## User Setup Required

None — documentation-only plan, no external service configuration or env vars changed.

## Next Phase Readiness

- DOCS-02 and DOCS-08 audit items closed; ready for Plan 16-03 (auth test convention fix).
- No blockers. `HandlerContext.enqueue` remains declared-optional at `packages/shared/src/types/cqrs.ts:29-30` — if a future plan decides to wire it at runtime (Option B deferred), both docs already acknowledge it as a "reserved type slot for a future direct-enqueue pathway", making that transition a prose-swap rather than a contradiction.

## Self-Check: PASSED

- `docs/integrations/bullmq.md` FOUND (modified)
- `docs/architecture.md` FOUND (modified)
- Commit `c666a76` FOUND (Task 1)
- Commit `f31c43e` FOUND (Task 2)
- `bun run scripts/validate-docs.ts` exits 0
- All acceptance-criteria grep invariants hold

---
*Phase: 16-v1-2-content-drift-fixes*
*Completed: 2026-04-19*
