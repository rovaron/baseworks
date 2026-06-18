# Typecheck Remediation Triage (branch `audit/full-scan-fix`)

Generated from `bun run typecheck 2>&1 | tee /tmp/tc.log` — **115 errors**.

Root `typecheck` = `tsc --noEmit` against the root `tsconfig.json`, whose `include`
globs `apps/*/src/**` and `packages/*/src/**`. Note web (`apps/web`) has **no `src/`
dir** (uses `app/`), so root typecheck only pulls in `apps/api/src` + `apps/admin/src`
+ all packages. `apps/admin` and `apps/web` own their real typecheck via their build
scripts (`tsc -b && vite build`, `next build`).

By error code: TS2493 ×26, TS2345 ×22, TS2532 ×18, TS2769 ×15, TS2307 ×15,
TS18048 ×6, TS2875 ×4, TS2339 ×3, TS2352 ×2, TS2322 ×2, TS7006 ×1, TS2503 ×1.

---

## Cluster 1 — Billing adapter / send-email tests (52)

**Files:** `packages/modules/billing/src/__tests__/{stripe-adapter,pagarme-adapter,billing}.test.ts`

**Errors:** TS2493 (`Tuple '[]' has no element at index 0/1`), TS2532 (`Object possibly undefined`),
TS2769 (`toContain` overload resolves to `(expected: undefined)`), TS2352 (`as string` on `undefined`).

**Root cause (one cause, not per-line):** the bun `mock(() => …)` factories declare **no
parameters**, so bun types `mock.calls` as `[]` (array of empty tuples). Every
`mockFetch.mock.calls[0][0]` / `logSpy.mock.calls[0][0]` then indexes a zero-length
tuple → `never`/`undefined`, which cascades into the TS2532/TS2769/TS2352. Example:
`pagarme-adapter.test.ts:58` `const callArgs = mockFetch.mock.calls[0]` then `callArgs[1].method`.

**Proper fix (no masking):** give each mock factory the real call signature so
`.mock.calls` is a typed tuple:
- fetch spies: `mock((_url: string, _init: RequestInit) => Promise.resolve(new Response(...)))`
  → `calls[0]` is `[string, RequestInit]`; `callArgs[0]` string (`.toContain` ok),
  `callArgs[1].method`/`.body` resolve, no `undefined`.
- `console.log` spy in `billing.test.ts`: `mock((..._args: unknown[]) => {})`
  → `calls[0]` is `unknown[]`, `calls[0][0]` is `unknown`; the existing `as string`
  cast (`unknown`→`string`) becomes legal (TS2352 gone). Keep the cast — it is a
  pre-existing narrowing of a logged arg, not new masking.

**`as any` temptation:** HIGH. The lazy path is `(mockFetch.mock.calls[0] as any)[0]`.
Do NOT — type the factory params instead; it is the same number of edited tokens.

**Verify:** `bun test packages/modules/billing`.

---

## Cluster 2 — Auth query/command tests (17)

**Files:** `packages/modules/auth/src/__tests__/{list-tenants,list-members,list-invitations,
get-tenant,get-invitation,create-tenant,update-tenant,accept-invitation,reject-invitation,
cancel-invitation}.test.ts`

**Errors:** TS2345 (`{…} / null` not assignable to `never[]` or `null`), TS2769
(`mockResolvedValueOnce` overload), TS2339 (`Result` shape).

**Root cause:** the better-auth API mocks infer their return type from the **seed
literal**, e.g. `mock(() => Promise.resolve([]))` → `Promise<never[]>`, and
`mock(() => Promise.resolve(null))` → `Promise<null>`. Subsequent
`mockResolvedValueOnce(orgs)` / `mockResolvedValueOnce(realObject)` then can't widen
to the real payload. (The `create-tenant` TS2339 `Property 'data' does not exist on Result`
is the same family: a mock whose too-narrow return makes the union resolve to the
`err` branch.)

**Proper fix:** annotate each mock factory's **return type** to the real better-auth
shape (or a representative `T | null` union the test exercises), e.g.
`mock((): Promise<Array<{ id: string; name: string; slug: string }> | null> => Promise.resolve([]))`.
Derive the element type from the production query's return type where practical
(`Awaited<ReturnType<typeof auth.api.listOrganizations>>`) so the fixture can't drift.
Reuse one typed fixture variable per file rather than re-annotating every call.

**`as any` temptation:** MEDIUM — `mockResolvedValueOnce(orgs as any)`. Forbidden;
type the mock generic/return instead.

**Verify:** `bun test packages/modules/auth`.

---

## Cluster 3 — Queue tests (8)

**File:** `packages/queue/src/__tests__/queue.test.ts` (lines 133/140/147/154)

**Errors:** TS18048 (`queue.opts.defaultJobOptions` / `.removeOnComplete` /
`.removeOnFail` possibly undefined), TS2339 (`Property 'age' does not exist on
type 'number | boolean | KeepJobs'`).

**Root cause:** the test reads policy back through bullmq's loose public type —
`queue.opts.defaultJobOptions?` is optional and `removeOnComplete/removeOnFail` are
`number | boolean | KeepJobs`. `.age` only exists on the `KeepJobs` object member.
`createQueue` (packages/queue/src/index.ts:63) DOES set these to `KeepJobs` objects
spread from `DEFAULT_JOB_OPTIONS`, but the read-back type can't know that.

**Proper fix (no `!`, no `as`):** narrow with a real runtime guard that also validates
the invariant the test asserts:
```ts
const opts = queue.opts.defaultJobOptions;
if (!opts || typeof opts.removeOnComplete !== "object") throw new Error("expected KeepJobs");
expect(opts.removeOnComplete.age).toBe(259200);
```
`typeof === "object"` discards the `number | boolean` members → `KeepJobs`, so `.age`
is valid and `opts` is non-undefined. (Alternative, also acceptable: `export
DEFAULT_JOB_OPTIONS` from the queue module and assert createQueue forwards it — but the
guard keeps the integration read against the live `queue.opts`.) Do NOT use `!` or
`as KeepJobs` — both are barred by the iron rules.

**Verify:** `bun test packages/queue`.

---

## Cluster 4 — Observability / middleware tests (14)

**Files:** `apps/api/src/core/middleware/__tests__/{observability,tenant-als-publish}.test.ts`

**Errors:** TS2345 — two distinct sub-causes:

**4a. `callApp(app: Elysia, …)` (observability.test.ts, ~11 hits).** The helper param
is the **bare default** `Elysia<"", {derive:{}}, …>`, but apps built with
`.use(observabilityMiddleware)` carry `derive: { _obsSpan: Span | null }` (and extra
singleton state), which is not assignable to the bare generic.
*Fix:* type `callApp` structurally to what it actually uses — it only calls
`app.handle(req)`:
```ts
async function callApp(app: { handle: (req: Request) => Promise<Response> }, req: Request, seedCtx: ObservabilityContext)
```
(Equivalently a generic `<T extends { handle: … }>`.) No `any`, accepts every Elysia
specialization.

**4b. Hand-annotated handler context (observability.test.ts:189
`({ set }: { set: { status: number } })`; tenant-als-publish.test.ts:43/58
`(ctx: { requestId: string })`).** Annotating the whole context param makes the
handler non-assignable to Elysia's `InlineHandlerNonMacro<…>` (Elysia's `set.status`
is a status union, not `number`; and the base context has no `requestId`).
*Fix for :189:* drop the annotation — `.get("/notfound-custom", ({ set }) => { set.status = 404; … })`;
Elysia infers `set`.
*Fix for tenant-als-publish:* the middleware is loaded via a **cache-busting dynamic
import** (`await import(\`../request-trace?t=...\`)`) which returns `any`, so `.use()`
can't add the `requestId` derive — that is why the annotation was bolted on. Restore
the type instead of annotating the handler:
```ts
const { requestTraceMiddleware } = (await import(`../request-trace?t=${Date.now()}`)) as
  typeof import("../request-trace");
```
then drop the `(ctx: { requestId: string })` annotation — `requestId` is inferred from
the now-typed derive. No `any`, behavior identical (still a fresh module per test).

**`as any` temptation:** HIGH on 4a (`callApp(app as any, …)`). Forbidden; structural
param type is the fix.

**Verify:** `bun test apps/api/src/core/middleware/__tests__`.

---

## Cluster 5 — Billing react-email JSX (5, PRODUCTION)

**Files:** `packages/modules/billing/src/templates/{welcome,password-reset,team-invite,
billing-notification}.tsx` (TS2875) + `packages/modules/billing/src/jobs/send-email.ts`
(TS2503 `Cannot find namespace 'JSX'`).

**Root cause:** billing depends on `react@19.2.4` (which ships `jsx-runtime.js`) but
**`@types/react` is not installed** in the package. With `jsx: "react-jsx"`, tsc needs
`react/jsx-runtime` *types* to typecheck the JSX → TS2875; and the global `JSX`
namespace is unavailable → TS2503. (Side note: billing's own `tsconfig.json` `include`
is `["src/**/*.ts"]` — it omits `.tsx`; the templates are only typechecked via the root
config today.)

**Proper fix (no behavior change):**
1. Add `@types/react@^19` to `packages/modules/billing` devDependencies and install
   (`bun install`). Provides `react/jsx-runtime` types + JSX intrinsics.
2. `send-email.ts:9` uses the **global** `JSX.Element`. React 19 `@types/react` no
   longer publishes a global `JSX` namespace (it moved under `React.JSX`). Replace with
   an imported type: `import type { JSX } from "react"` (then keep `JSX.Element`) or
   `import type { ReactElement } from "react"` and use `ReactElement`. Runtime behavior
   unchanged (type-only).
3. Add `"src/**/*.tsx"` to `packages/modules/billing/tsconfig.json` `include` so the
   package's own typecheck covers the templates.

**`as any` temptation:** LOW, but avoid the shortcut of casting template fns to
`(d:any)=>any` in `send-email.ts` — install the types instead.

**Verify:** `bun test packages/modules/billing` (render path).

---

## Cluster 6 — apps/admin (14)

**Files:** `apps/admin/src/{layouts/*,lib/*,routes/**}` — 13× TS2307
(`Cannot find module '@/lib/api' | '@/components/data-table' | '@/hooks/...' | '@/lib/...'`)
+ 1× TS7006 (`apps/admin/src/routes/tenants/detail.tsx:188` param `file` implicitly `any`).

**Root cause — TWO independent problems:**

**6a. Root-typecheck noise (the 13 TS2307).** All targets exist
(`apps/admin/src/lib/api.ts`, `components/data-table.tsx`, `hooks/use-focus-on-navigate.ts`
are present). They fail only because the **root tsconfig has no `@/*` path** yet its
`include` pulls in `apps/admin/src`. `@/*` can't live in the root config (admin AND web
both alias `@/` to different roots — admin→`./src/*`, web→`./*`). Correct fix is to stop
the root config from typechecking app-owned source: **exclude `apps/admin/src` (and be
explicit about `apps/web`) from the root `tsconfig.json`**, leaving each app's own
`tsc -b`/`next build` as the gate (which the operator already requires as separate green
checks). This is config separation, not suppression — admin coverage is fully preserved
by `cd apps/admin && bun run build`.

**6b. admin's OWN build (`tsc -b`) eden `.admin` failure.** `apps/admin/tsconfig.json`
lacks the backend workspace paths. `@baseworks/api-client/src/treaty.ts:1` does
`import type { App } from "@baseworks/api"`; admin's config maps only `@/`,
`@baseworks/ui`, `@baseworks/api-client` → `@baseworks/api` (and its transitive
`@baseworks/*` imports) is unresolvable → eden `App` degrades, `.admin` (TS2339) goes
missing. Fix in §"exact tsconfig change" below.

**6c. Real admin bug (TS7006).** `tenants/detail.tsx:188` `onFileSelect={(file) => …}` —
annotate the `file` param with its real type (the upload-adapter's file type, e.g.
`File`), do not leave it implicit and do not use `any`.

**Verify:** `cd apps/admin && bun run build`.

---

## Cluster 7 — Misc production (5)

| File | Error | Root cause | Fix |
|---|---|---|---|
| `apps/api/src/routes/health-detailed.ts:18` | TS2307 `Cannot find module 'ioredis'` | `import type IORedis from "ioredis"` but `ioredis` is only a transitive dep of bullmq; not declared in `apps/api/package.json` | Add `ioredis` to `apps/api` deps (ships own types) and `bun install`. Type-only import, no behavior change. |
| `apps/api/src/routes/health-detailed.ts:44` | TS2322 return type | factory annotated `: Elysia` (bare) but the `.use(requirePlatformAdmin()).get(...)` chain carries route/macro/derive params not assignable to bare `Elysia` | Drop the explicit `: Elysia` return annotation and let TS infer the precise plugin type (better for eden too). No masking. |
| `apps/api/src/routes/bull-board.ts:74` | TS2322 return type | same as above (built chain vs bare `Elysia` annotation) | Remove/replace the bare `Elysia` annotation; let inference flow. |
| `packages/modules/auth/src/auth.ts:8` | TS2307 `Cannot find module 'bullmq'` | `import type { Queue } from "bullmq"` but auth has no `bullmq` dep | Import the `Queue` type from `@baseworks/queue` (it already wraps bullmq — re-export the type there if needed), OR add `bullmq` to auth deps. Prefer routing the type through `@baseworks/queue` to keep the bullmq dependency centralized. |
| `packages/modules/auth/src/commands/cancel-invitation.ts:35` | TS2769 (`'organizationId' does not exist in type '{ invitationId: string }'`) | real bug — better-auth `cancelInvitation` body accepts only `{ invitationId }` | Remove `organizationId` from the `body`. Behavior preserved: the cancel is keyed by invitation; `ctx.emit` still carries `input.organizationId`. |

---

## Exact `apps/admin/tsconfig.json` change (Cluster 6b)

Add the backend workspace paths so `@baseworks/api` (and what it transitively imports)
resolve into source, matching the root config. Merge into the existing `paths` block
(keep `@/*`, `@baseworks/ui*`, `@baseworks/api-client*`):

```jsonc
"paths": {
  "@/*": ["./src/*"],
  "@baseworks/ui": ["../../packages/ui/src"],
  "@baseworks/ui/*": ["../../packages/ui/src/*"],
  "@baseworks/api-client": ["../../packages/api-client/src"],
  "@baseworks/api-client/*": ["../../packages/api-client/src/*"],
  "@baseworks/api": ["../../apps/api/src"],
  "@baseworks/db": ["../../packages/db/src"],
  "@baseworks/db/*": ["../../packages/db/src/*"],
  "@baseworks/shared": ["../../packages/shared/src"],
  "@baseworks/shared/*": ["../../packages/shared/src/*"],
  "@baseworks/config": ["../../packages/config/src"],
  "@baseworks/config/*": ["../../packages/config/src/*"],
  "@baseworks/observability": ["../../packages/observability/src"],
  "@baseworks/observability/*": ["../../packages/observability/src/*"],
  "@baseworks/storage": ["../../packages/storage/src"],
  "@baseworks/storage/*": ["../../packages/storage/src/*"],
  "@baseworks/i18n": ["../../packages/i18n/src"],
  "@baseworks/i18n/*": ["../../packages/i18n/src/*"],
  "@baseworks/queue": ["../../packages/queue/src"],
  "@baseworks/queue/*": ["../../packages/queue/src/*"],
  "@baseworks/module-*": ["../../packages/modules/*/src"]
}
```

(Paths are root paths rebased from `./` to `../../`. Equivalent alternative: have admin's
config `extend` the root and only override `@/*`, `jsx`, `include` — but an explicit
paths block keeps admin self-contained and avoids inheriting root's `include` globs.)

Depends on Cluster 7 (auth.ts/cancel-invitation) + the backend being type-clean: once
`@baseworks/api` resolves into a clean backend, `apps/api/src/index.ts`'s unconditional
`.use(adminRoutes)` + `export type App = typeof app` makes `.admin` resolve and the
deep eden typecheck passes.

---

## Root `tsconfig.json` change (Cluster 6a)

Stop root typecheck from compiling app-owned source (each app has its own `@/` alias,
JSX/build config, and a dedicated build gate). Add to `exclude`:

```jsonc
"exclude": ["node_modules", "dist", "apps/admin", "apps/web"]
```

`apps/api/src` stays in scope (it is the backend the root config is meant to check).
This removes the 13 admin TS2307 from root typecheck; admin's own `tsc -b` (with §6b
paths) plus its TS7006 fix (§6c) keep admin fully covered.

---

## Suppression-risk ranking (where `as any` tempts most)

1. **Cluster 1 (billing mocks)** — `(calls[0] as any)[0]`. Real fix: typed mock factory params.
2. **Cluster 4a (Elysia variance)** — `callApp(app as any)`. Real fix: structural `{ handle }` param.
3. **Cluster 2 (auth mocks)** — `mockResolvedValueOnce(x as any)`. Real fix: typed mock return.
4. **Cluster 3 (queue union)** — `as KeepJobs` / `!`. Real fix: `typeof === "object"` guard.

No `as any`, `@ts-ignore`, `@ts-expect-error`, or non-null `!` may be added for any of
these. Existing eden-call-site `as any` instances are out of scope and must not multiply.

## Ordering / dependencies

1. Clusters 5 + 7 (production deps/types) and Cluster 2/7 auth fixes first — they make
   the backend type-clean.
2. Then Cluster 6b (admin tsconfig paths) so eden `.admin` resolves against the clean backend.
3. Test-only clusters (1, 2, 3, 4) independently; re-run `bun test <pkg>` after each.
4. Config edits (root exclude, admin paths) last-verified by `bun run typecheck`,
   `cd apps/admin && bun run build`, `bun run build:web`, and full `bun run test`.
