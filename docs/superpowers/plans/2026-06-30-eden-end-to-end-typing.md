# Eden Treaty End-to-End Typing — Implementation Plan

> **For agentic workers:** Execute phase-by-phase. Each phase ends with a verification gate; if it fails, STOP and report (do not paper over with `as any`). Per-phase commits.

**Goal:** Make the Eden Treaty client (`api.api.*`) genuinely typed end-to-end in both `apps/web` and `apps/admin`, so API calls get compile-time param + response checking and the `as any` casts can be removed.

**Diagnosis (already established — do not re-investigate):**
1. **`apps/web/tsconfig.json` is missing 9 `@baseworks/*` path aliases** that `App`'s type transitively needs → `App` resolves to `any` in web → the whole web client is untyped. (`apps/admin` already has the full alias set.) Confirmed against Eden issue elysiajs/eden#110 ("path alias must resolve to the same file on both sides").
2. **Module route types are erased before they reach `App`:** `ModuleDefinition.routes` is typed `any` (`packages/shared/src/types/module.ts:50`), and `registry.getModuleRoutes()` chains modules in a runtime loop with `plugin.use(def.routes as any)` (`apps/api/src/core/registry.ts:211`). Billing/auth are mounted via conditional `?? new Elysia()` which also erases types. Net: `notifications`, `files`, `example`, and most of `billing` are NOT in `App`'s type.
3. **No enforcement:** web has `typescript.ignoreBuildErrors: true` (`apps/web/next.config.*`) AND is excluded from the root `tsc` (`tsconfig.json` `exclude`). So web has had zero type-checking — hiding `api.api: any` and real bugs (e.g. `auth.forgetPassword` → should be `resetPassword`).

**Modules with route plugins:** `authRoutes` (@baseworks/module-auth), `billingRoutes` (@baseworks/module-billing), `exampleRoutes` (@baseworks/module-example), `filesRoutes` (@baseworks/module-files), `notificationRoutes` (@baseworks/module-notifications). Each is a concrete Elysia instance assigned to the module's `routes:` field but stored through the `any`-typed `ModuleDefinition.routes`.

**Hard constraint (all phases):** NEVER introduce a new `as any` / `@ts-ignore` / `@ts-expect-error` to silence a type error. Fix the underlying type or the call site. Removing existing `as any` is a goal. If a genuine type problem can't be solved without a cast, STOP and report it for review.

**Tech:** Elysia 1.4 + @elysiajs/eden 1.4, Bun, Next.js (web), Vite/React-Router (admin), TypeScript strict.

---

## Phase 1 — Make module route types flow into `App` (backend)

**Why:** Eden infers `App = typeof app` from statically-chained `.use()` calls. The runtime loop + `as any` + `?? new Elysia()` discard the types. Replace them with static, typed chaining.

**Files:**
- `packages/modules/{example,files,notifications}/src/index.ts` — re-export the concrete route plugin (the auth/billing packages likely already do; verify).
- `apps/api/src/index.ts` — static-chain the route plugins; stop mounting routes via the registry loop / conditional-erasing mounts.
- `apps/api/src/core/registry.ts` — `getModuleRoutes()` no longer needed for routes (keep the registry for jobs/commands/events).

**Steps:**
1. In each module package index (example, files, notifications — and confirm auth, billing), add a named re-export of the concrete route plugin, e.g. `export { notificationRoutes } from "./routes";`. Keep the existing `ModuleDefinition` default export unchanged. Verify each plugin is a concrete `Elysia` (NOT cast to `any` anywhere on the export path).
2. In `apps/api/src/index.ts`: import the concrete plugins (`authRoutes`, `billingRoutes`, `exampleRoutes`, `filesRoutes`, `notificationRoutes`) and replace the route-mounting that currently erases types — specifically:
   - the `.use(registry.getModuleRoutes())` line, and
   - the conditional `.use(billingApiRoutes ?? new Elysia())` / `.use(authRoutes ?? new Elysia())` style mounts (the `?? new Elysia()` widens the type and erases routes — mount the concrete plugin directly; if a worker-role guard is needed, gate at runtime without an `any`/union-erasing fallback, e.g. an `if (role !== "worker") app = app.use(plugin)` pattern that preserves types, or chain unconditionally and let the worker simply not receive traffic).
   - Preserve mount ORDER and any middleware-band placement (tenant middleware vs admin band) — module routes that need tenant context must stay after `tenantMiddleware`; `/api/admin` stays in the cross-tenant band. Match the current ordering.
3. Ensure routes are mounted EXACTLY ONCE (no double-mount now that the registry no longer attaches them). Update/trim `registry.getModuleRoutes()` accordingly (and its tests in `apps/api/src/core/__tests__/registry.test.ts` — the "worker role skips route attachment" expectation may move).
4. If `ModuleDefinition.routes: any` is no longer the mount path, optionally tighten its type — but only if it doesn't cascade; otherwise leave it (it's no longer in the type-critical path).

**Gate:**
- `bun run typecheck` passes (root — covers apps/api + packages).
- `bun test apps/api/src/core/__tests__/registry.test.ts` passes (adjust expectations for the moved route mounting; do NOT delete coverage).
- Boot probe: `STRIPE_WEBHOOK_SECRET=whsec_dummy bun run apps/api/src/index.ts` starts and `curl -s localhost:3000/swagger` → 200; spot-check that a module route still responds (e.g. `curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/notifications/...` behaves as before — 401/422, not 404). Confirm no route is registered twice (grep startup logs / no Elysia duplicate-route warnings).
- **Type probe (the real success metric):** temporarily add `apps/api/src/__probe.ts` with `import type { App } from "./index"; type _R = App extends { _routes: infer R } ? R : never;` is unreliable — instead verify from a consumer in Phase 2. For Phase 1, the gate is: typecheck + boot + single-mount.

**Commit:** `refactor(api): static-chain module route plugins so types reach Eden's App`

---

## Phase 2 — Frontend path resolution + turn on enforcement

**Files:**
- `apps/web/tsconfig.json` — add the 9 missing aliases.
- `apps/web/next.config.*` — remove `typescript.ignoreBuildErrors: true`.
- root `tsconfig.json` and/or `package.json` `typecheck` script — include `apps/web` + `apps/admin` so CI type-checks them.

**Steps:**
1. Add to `apps/web/tsconfig.json` `paths` (mirroring `apps/admin/tsconfig.json`, identical relative paths since both are `apps/*`): `@baseworks/db`, `@baseworks/db/*`, `@baseworks/shared`, `@baseworks/shared/*`, `@baseworks/config`, `@baseworks/config/*`, `@baseworks/observability(/*)`, `@baseworks/storage(/*)`, `@baseworks/i18n(/*)`, `@baseworks/queue(/*)`, `@baseworks/module-*` → `../../packages/modules/*/src`, `@baseworks/api` → `../../apps/api/src`.
2. Establish the baseline: run BOTH apps' own typechecks and record the error list:
   - web: `cd apps/web && bunx tsc --noEmit`
   - admin: `cd apps/admin && bunx tsc --noEmit`
   These will report the latent errors (Phase 3 fixes them). Phase 1 should have REDUCED them (module routes now typed) — verify several previously-"does not exist" route errors (notifications/files/billing.subscription) are GONE.
3. Wire enforcement so this can't regress: make the root `typecheck` script (or a new `typecheck:apps`) run `tsc --noEmit` for web and admin too (e.g. `tsc --noEmit && tsc --noEmit -p apps/web/tsconfig.json && tsc --noEmit -p apps/admin/tsconfig.json`), OR add them to the root tsconfig `include` and drop them from `exclude`. Remove `ignoreBuildErrors` from web. NOTE: enforcement will FAIL until Phase 3 — that's expected; keep the enforcement change in this phase but the green gate is achieved at the end of Phase 3.

**Gate:**
- `apps/api` typecheck still green.
- The route-existence errors from Phase-1-typed modules are gone in the baseline (proves App now carries module routes end-to-end). Record remaining error count for web + admin.

**Commit:** `build(web): add missing @baseworks path aliases + enable type enforcement`

---

## Phase 3 — Fix the surfaced type errors (no new casts)

**Files:** whatever the Phase 2 baseline lists. Expected categories:
- **Real bugs hidden by `any`:** e.g. `auth.forgetPassword` → `resetPassword`; `auth` org-role methods (`listOrgRoles`/`createOrgRole`/`deleteOrgRole`) that don't exist on the better-auth client — find the correct API (check the better-auth org plugin client surface) and fix. These are genuine bugs; verify against the better-auth client types, do not invent.
- **Response narrowing:** calls now return the typed Eden `{ data, error }` and (for Result-envelope routes) `data: { success, data } | { success, error }`. Narrow properly (`if (res.error) ...; if (!res.data.success) ...; return res.data.data`).
- **Param/body mismatches:** typed routes may reveal wrong body/query shapes — align the call with the route schema (fixing whichever side is wrong; if the backend schema is wrong, fix it).

**Approach:** Fix per-file. Web and admin are independent apps → their fixes can proceed in parallel, but within an app fix sequentially (type changes cascade). After each file, re-run that app's `tsc --noEmit` to confirm the count drops and no new errors appear.

**Gate:** `cd apps/web && bunx tsc --noEmit` and `cd apps/admin && bunx tsc --noEmit` both **clean**. No new `as any`/`@ts-*` added (grep the diff).

**Commit(s):** per file or per area, e.g. `fix(web): correct auth client calls + narrow typed Eden responses`

---

## Phase 4 — Drop the now-unnecessary casts + final verification

**Files:** the 10 cast sites previously inventoried —
`apps/web/lib/{notifications-api,webhooks-api}.ts`, `apps/admin/src/lib/file-upload-adapters.ts`, `apps/admin/src/routes/{roles/list,tenants/detail,tenants/list,users/detail,users/list,webhooks/deliveries-dialog,webhooks/list}.tsx`.

**Steps:**
1. Remove `(api.api as any)` accessor casts and `(api.api.X as any)({ id })` dynamic-param casts; replace with the plain typed calls (`api.api.notifications`, `api.api.admin.tenants({ id })`, etc.). For the web wrapper files, also remove the loose `unwrap`/`?? res.data` shims in favour of typed narrowing now that responses are typed.
2. Re-run both apps' typechecks — they must stay clean WITHOUT the casts. Any error here means a real typing gap from Phase 1/3 — fix the root cause, do not re-add the cast.

**Gate (final, all must pass):**
- `bun run typecheck` (now including web + admin) — clean.
- `bun test packages/modules/notifications` and `bun test apps/api/src/core` — green (registry change).
- `cd apps/web && bunx vitest run` and `cd apps/admin && bunx vitest run` — green.
- `bun run build:web` and `bun run build:admin` — succeed.
- API boot probe — starts, swagger 200, module routes respond (single-mounted).
- `bunx biome check` — clean (no new warnings beyond pre-existing).
- `grep -rE "as any" apps/web apps/admin --include=*.ts --include=*.tsx | grep -i api` → the inventoried Eden casts are gone.

**Commit:** `refactor(web,admin): drop Eden any-casts now that the client is fully typed`

---

## Self-Review Notes (for the implementer)

- **The whole point is to ADD type safety. Adding `as any` to "make it pass" defeats the task — it is forbidden.** If stuck, stop and surface the specific type for review.
- **Phase 1 is the architectural crux and the riskiest** — verify the app still boots and routes mount exactly once before moving on. Preserve middleware-band ordering (tenant vs admin/cross-tenant).
- **Runtime module gating:** static chaining means all chained modules' routes are in the type AND mounted. If a deploy needs to disable a module, that becomes a compile-time choice (don't chain it). This is the accepted trade-off for Eden typing (the chosen approach). The registry still governs jobs/commands/events at runtime.
- **better-auth errors are real bugs** the `any` was hiding — fix them correctly against the better-auth client API, don't paper over.
- **Enforcement (Phase 2) intentionally goes red until Phase 3 finishes** — that's the safety net that keeps this from regressing.
