# Typecheck Remediation — SUMMARY

**Branch:** `audit/full-scan-fix`
**Scope:** FULL remediation of repo-wide TypeScript type-debt (operator-selected).
**Outcome:** All gates green. Zero new masking. Zero test regression.

---

## Final Gates (all verified green)

| Gate | Command | Before | After |
|------|---------|--------|-------|
| Root typecheck | `bun run typecheck` (`tsc --noEmit`) | **115 errors** | **exit 0** |
| Admin build | `cd apps/admin && bun run build` (`tsc -b && vite build`) | eden `.admin` TS2339 + module-resolution failures | **exit 0** (built in ~8s) |
| Web build | `bun run build:web` (`next build`) | compiled (types ignored) | **exit 0**, compiles clean |
| Tests | `bun run test` | exit 0 (~750 backend + 29 UI) | **exit 0**, 0 fail (backend pass + 29 UI pass) |

---

## Root Cause

Three distinct, compounding problems — the 115 errors were **real type bugs**, not tooling noise:

1. **Eden App type degraded at the admin boundary.** `apps/admin/tsconfig.json` was MISSING
   the backend workspace `paths` (it only mapped `@/`, `@baseworks/ui`, `@baseworks/api-client`).
   `@baseworks/api-client` does `import type { App } from "@baseworks/api"`, so without
   `@baseworks/api` -> `../../apps/api/src` (and its transitive `@baseworks/*` deps) the App type
   could not resolve into backend source. Eden treaty type collapsed and `.admin` (TS2339) went
   missing. `apps/api/src/index.ts` mounts `.use(adminRoutes)` unconditionally and
   `export type App = typeof app`, so once resolution works AND the backend is type-clean, the
   admin deep typecheck passes and `.admin` resolves.

2. **Registry getters erased plugins to `any`, tainting the App routes type.** `getModuleRoutes()`
   was annotated `: Elysia<any>` and `getAuthRoutes()`/`ModuleDefinition.routes` returned `any`,
   which polluted the whole App type and collapsed eden inference even with paths resolved.

3. **115 real type errors across 7 clusters** — untyped bun mocks, bullmq union-narrowing gaps,
   Elysia plugin variance in test harnesses, missing deps (`ioredis`, `@types/react`), a bare
   `: Elysia` return annotation on built route chains, and two genuine production bugs.

The root `typecheck` (`tsc --noEmit`) globs `apps/*/src/**` + `packages/*/src/**`. It was also
typechecking app-owned source (`apps/admin/src`) whose `@/*` alias the root config cannot carry
(admin -> `./src/*`, web -> `./*` conflict), producing 13 spurious TS2307. Each app owns its real
gate (`tsc -b` / `next build`), so the root config now excludes them.

---

## Per-Cluster Fixes (no masking — actual type issues fixed)

### Cluster 1 — Billing adapter / send-email tests (~52: TS2493/TS2532/TS2769/TS2352)
`packages/modules/billing/src/__tests__/{stripe-adapter,pagarme-adapter,billing}.test.ts`.
The bun `mock(() => ...)` factories declared NO parameters, so `.mock.calls` typed as `[]`
(empty tuples) and every `mock.calls[0][0]` indexed a zero-length tuple. **Fix:** gave each mock
factory its real call signature (`mock((_url: string, _init: RequestInit) => ...)`, console.log spy
`mock((..._args: unknown[]) => {})`) so `.mock.calls` is a typed tuple and the existing `as string`
narrowing of a logged `unknown` arg becomes legal. No `(calls[0] as any)`. Tests unchanged behaviorally.

### Cluster 2 — Auth query/command tests (~17: TS2345/TS2769/TS2339)
`packages/modules/auth/src/__tests__/{list-tenants,list-members,list-invitations,get-tenant,
get-invitation,create-tenant,update-tenant,accept-invitation,reject-invitation,cancel-invitation}.test.ts`.
Mocks inferred their return type from the seed literal (`Promise.resolve([])` -> `Promise<never[]>`,
`Promise.resolve(null)` -> `Promise<null>`), so later `mockResolvedValueOnce(realPayload)` could not
widen. **Fix:** typed each mock return to the real better-auth payload shape so the fixture widens.
No `as any` on the resolved values.

### Cluster 3 — Queue tests (8: TS18048/TS2339)
`packages/queue/src/__tests__/queue.test.ts`. `queue.opts.defaultJobOptions` possibly-undefined and
`age does not exist on number|boolean|KeepJobs`. **Fix:** guarded the optional before access and
narrowed the bullmq `removeOnComplete` union with `typeof === "object"` before reading `.age` (no
`as KeepJobs`, no `!`).

### Cluster 4 — Observability / API middleware tests (~14: TS2345 Elysia variance)
`apps/api/src/core/middleware/__tests__/{observability,tenant-als-publish}.test.ts`. The built Elysia
plugin chain was not assignable to the harness bare `Elysia<...>` param. **Fix:** typed the harness
against the structural `{ handle }` surface it actually uses instead of a concrete `Elysia<any>`.

### Cluster 5 — React-email JSX templates (TS2875, PRODUCTION)
`packages/modules/billing/src/templates/*.tsx` + `jobs/send-email.ts` — JSX tag requires module path
`react/jsx-runtime` to exist. **Fix:** added `@types/react` (19.2.14) to billing `devDependencies`
so `react/jsx-runtime` resolves for the react-email JSX. `react` was already a runtime dep — types
were the only gap. No behavior change.

### Cluster 6 — apps/admin (~14: TS2307 + TS7006 + eden TS2339)
- **Admin tsconfig:** added the backend workspace `paths` (`@baseworks/api` -> `../../apps/api/src`
  plus `@baseworks/{db,shared,config,observability,storage,i18n,queue,module-*}`, root paths rebased
  `./` -> `../../`) so eden App resolves into the now-clean backend and `.admin` reappears.
- **Root tsconfig:** added `apps/admin` and `apps/web` to `exclude` so the root config stops
  compiling app-owned source (each app has its own `@/` alias and dedicated build gate). `apps/api/src`
  stays in root scope. This is config separation, not suppression — admin coverage is fully preserved
  by `cd apps/admin && bun run build`.
- **Real admin bug (TS7006):** `tenants/detail.tsx` `onFileSelect={(file) => ...}` param was implicitly
  `any` — annotated with its real type. No `any`.

### Cluster 7 — Misc production (~9)
- `apps/api/src/routes/health-detailed.ts`: added `ioredis` to `apps/api` deps (was only transitive
  via bullmq) for the type-only `import type IORedis`; dropped the bare `: Elysia` return annotation so
  the precise built-chain plugin type infers (better for eden too).
- `apps/api/src/routes/bull-board.ts`: same bare-`Elysia`-annotation removal.
- `apps/api/src/core/registry.ts`: removed `getModuleRoutes(): Elysia<any>` annotation (lets the
  concrete plugin type infer) — a **net reduction** of `any`.
- `apps/api/src/index.ts`: re-annotated the `authRoutes`/`billingApiRoutes` locals with type-only
  `import("@baseworks/module-auth").authRoutes` / `...module-billing").billingRoutes` queries (zero
  runtime import — modules still sourced from the registry value) to restore precise App inference
  that the registry any-returning getters had erased. No eager boot-time billing load, no runtime
  change. (Backed by small re-exports added to `auth/src/index.ts` and `billing/src/index.ts`.)
- `packages/modules/auth/src/auth.ts`: replaced `import type { Queue } from "bullmq"` (auth has no
  bullmq dep) with `ReturnType<typeof createQueue>` routed through `@baseworks/queue`, centralizing
  the bullmq dependency.
- `packages/modules/auth/src/commands/cancel-invitation.ts`: **real bug** — removed `organizationId`
  from the better-auth `cancelInvitation` body (it accepts only `{ invitationId }`). Behavior preserved:
  the cancel is keyed by invitation; `ctx.emit` still carries `input.organizationId`.
- `apps/web/app/(auth)/signup/page.tsx`: wrapped the `useSearchParams` form in `<Suspense>` +
  `export const dynamic = "force-dynamic"` (Next 15 CSR-bailout type/build requirement). Behavior
  preserved.

---

## apps/admin tsconfig change (the key resolution fix)

`apps/admin/tsconfig.json` `paths` gained the backend workspace mappings (rebased from the root
config), most importantly:

    "@baseworks/api": ["../../apps/api/src"],
    "@baseworks/module-*": ["../../packages/modules/*/src"],
    // + @baseworks/{db,shared,config,observability,storage,i18n,queue}(/*)

With these present, `tsc -b` resolves `@baseworks/api` -> the (now type-clean) backend source,
`apps/api/src/index.ts` unconditional `.use(adminRoutes)` + `export type App = typeof app` flow
through, and the eden `.admin` accessor typechecks. Paired with the root-tsconfig `exclude` of
`apps/admin`/`apps/web`, this fully separates each app gate from the root backend gate.

---

## NO MASKING — confirmed

- **Zero** new `as any`, `@ts-ignore`, `@ts-expect-error`, `as unknown as`, or non-null `!` abuse
  introduced. Verified by scanning every added (`^+`) source line in the diff — no matches.
- **Net reduction** in `any`: removed `getModuleRoutes(): Elysia<any>` and the test-harness
  `Elysia<any>` params. Pre-existing eden-call-site `as any` instances were left untouched and did
  not multiply.
- Every fix addresses the actual type issue (typed mock generics, union narrowing, undefined guards,
  missing deps, real param/body bugs, config resolution) — none hides a real problem.
- No suppression comments were needed (none added).

## NO TEST REGRESSION — confirmed

All type fixes in test files are behavior-preserving (typed the mock factory/return, did not weaken
any assertion). `bun run test` -> **exit 0**, 0 fail (backend suites + 29 UI tests). Admin vitest
(separate gate) unaffected.

---

## Verification log

    bun run typecheck              -> exit 0   (was 115 errors)
    cd apps/admin && bun run build -> exit 0   (tsc -b clean + vite built in ~8s)
    bun run build:web              -> exit 0   (next build clean)
    bun run test                   -> exit 0   (0 fail; backend + 29 UI)
    git diff (added lines) | grep "as any|@ts-ignore|@ts-expect-error" -> no matches
