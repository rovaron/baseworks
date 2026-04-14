---
phase: 12-i18n-string-cleanup
plan: 02
subsystem: i18n
tags: [i18n, react-i18next, admin, namespace-registration]

requires:
  - phase: 08-internationalization
    provides: "@baseworks/i18n package with enInvite/ptBRInvite exports and invite.json translation files"
provides:
  - "apps/admin react-i18next resource registration covers all 6 namespaces (common, auth, dashboard, billing, admin, invite)"
  - "Any future admin UI consuming invite:* keys resolves against the bundled JSON (no silent fallback to key paths)"
affects: [admin-invite-ui, 12-i18n-string-cleanup, future admin invite management views]

tech-stack:
  added: []
  patterns:
    - "Admin react-i18next resources object must stay in lockstep with packages/i18n/src/index.ts namespaces constant"

key-files:
  created: []
  modified:
    - apps/admin/src/lib/i18n.ts

key-decisions:
  - "Additive edit only: no changes to i18n.init() options, interpolation settings, or namespaces constant"
  - "Order invite last in each locale block to mirror the namespaces tuple at packages/i18n/src/index.ts:5"

patterns-established:
  - "6-namespace parity invariant: every namespace declared in @baseworks/i18n must be resource-registered in apps/admin/src/lib/i18n.ts"

requirements-completed: [I18N-04]

duration: 5min
completed: 2026-04-14
---

# Phase 12 Plan 02: Admin Invite Namespace Registration Summary

**Registered the invite namespace in apps/admin react-i18next resources so admin UI can resolve invite:* keys against bundled translations instead of silently falling back to key paths**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-14T22:05:00Z (approx)
- **Completed:** 2026-04-14T22:10:22Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- `enInvite` and `ptBRInvite` added to the named import block from `@baseworks/i18n`
- `resources.en.invite` and `resources["pt-BR"].invite` populated with the bundled JSON translations
- apps/admin now covers all 6 namespaces declared in `packages/i18n/src/index.ts` — no more gap between `ns: [...namespaces]` (6 entries) and the resources object (previously 5)
- Zero changes to `i18n.init(...)` options, interpolation prefix/suffix, or any other file

## Task Commits

1. **Task 1: Register invite namespace in admin react-i18next resources** - `8052eef` (fix)

_Plan metadata commit will be created by the orchestrator after the wave completes._

## Files Created/Modified
- `apps/admin/src/lib/i18n.ts` - Added `enInvite`/`ptBRInvite` imports and `invite` entries in both `en` and `pt-BR` resource blocks

## Before/After Diff

**Before (relevant excerpt):**
```typescript
import {
  defaultLocale,
  locales,
  namespaces,
  enCommon,
  enAuth,
  enDashboard,
  enBilling,
  enAdmin,
  ptBRCommon,
  ptBRAuth,
  ptBRDashboard,
  ptBRBilling,
  ptBRAdmin,
} from "@baseworks/i18n";

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    billing: enBilling,
    admin: enAdmin,
  },
  "pt-BR": {
    common: ptBRCommon,
    auth: ptBRAuth,
    dashboard: ptBRDashboard,
    billing: ptBRBilling,
    admin: ptBRAdmin,
  },
};
```

**After:**
```typescript
import {
  defaultLocale,
  locales,
  namespaces,
  enCommon,
  enAuth,
  enDashboard,
  enBilling,
  enAdmin,
  enInvite,
  ptBRCommon,
  ptBRAuth,
  ptBRDashboard,
  ptBRBilling,
  ptBRAdmin,
  ptBRInvite,
} from "@baseworks/i18n";

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    billing: enBilling,
    admin: enAdmin,
    invite: enInvite,
  },
  "pt-BR": {
    common: ptBRCommon,
    auth: ptBRAuth,
    dashboard: ptBRDashboard,
    billing: ptBRBilling,
    admin: ptBRAdmin,
    invite: ptBRInvite,
  },
};
```

## Grep Verification

| Assertion | Expected | Actual | Result |
|-----------|----------|--------|--------|
| `grep -c "invite:" apps/admin/src/lib/i18n.ts` | `>= 2` | 2 | PASS |
| `grep -c "enInvite\|ptBRInvite" apps/admin/src/lib/i18n.ts` | `>= 2` | 4 | PASS |
| `grep -c "enInvite" apps/admin/src/lib/i18n.ts` | `>= 2` | 2 | PASS |
| `grep -c "ptBRInvite" apps/admin/src/lib/i18n.ts` | `>= 2` | 2 | PASS |
| `grep -c "from \"@baseworks/i18n\"" apps/admin/src/lib/i18n.ts` | `>= 1` | 1 | PASS |
| `grep -c "initReactI18next" apps/admin/src/lib/i18n.ts` | `>= 1` | 1 | PASS |
| `grep -c "ns: \[...namespaces\]" apps/admin/src/lib/i18n.ts` | `>= 1` | 1 | PASS |

## Typecheck Result

Ran `bunx tsc -b` from `apps/admin`. `apps/admin/src/lib/i18n.ts` emits zero TypeScript diagnostics related to the edited symbols (`enInvite`, `ptBRInvite`, `resources`, `invite` keys). Filtered grep for `i18n.ts` or `invite` in the tsc output returned zero matches.

Pre-existing, unrelated diagnostics were observed in the same run (out of scope for this plan, deferred — see "Deferred Issues" below):
- `src/routes/billing/overview.tsx`, `src/routes/system/health.tsx`, `src/routes/tenants/*.tsx`, `src/routes/users/*.tsx`: Eden Treaty client shape missing `admin` property
- `packages/api/src/core/{registry,middleware/tenant}.ts`, `packages/api/src/index.ts`, `packages/api/src/routes/admin.ts`: missing `@baseworks/module-auth`, `@baseworks/module-billing`, `@baseworks/module-example` modules and missing `validatePaymentProviderEnv` export
- `packages/config`: missing `validatePaymentProviderEnv` export

None of these touch `apps/admin/src/lib/i18n.ts`, none reference `invite`, and none are caused by this plan's edit.

## Decisions Made
- "None - followed plan as specified"
- Additive-only edit per plan D-14: registration happens even though no admin UI currently consumes `invite.*` keys, so the phase success criterion holds as a latent-bug-prevention invariant.

## Deviations from Plan

None - plan executed exactly as written.

## Deferred Issues

- Pre-existing TypeScript errors in `apps/admin` routes (`billing/overview`, `system/health`, `tenants/*`, `users/*`) referencing a missing `admin` property on the Eden Treaty client.
- Pre-existing TypeScript errors in `packages/api` referencing modules `@baseworks/module-auth`, `@baseworks/module-billing`, `@baseworks/module-example` and a missing `validatePaymentProviderEnv` export from `@baseworks/config`.
- These are out of scope (SCOPE BOUNDARY: unrelated pre-existing failures). Logged here for future-phase triage — not caused by this plan and not blocking its acceptance criteria, which are strictly `apps/admin/src/lib/i18n.ts`-scoped.

## Issues Encountered
- `bun run -F @baseworks/admin typecheck` failed with "No packages matched the filter" because `apps/admin/package.json` does not define a `typecheck` script. Worked around by running `bunx tsc -b` directly inside `apps/admin`. No plan change needed — verification intent was satisfied.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Admin i18n resources now mirror the declared `namespaces` constant; any future admin-side invite management view can call `t("invite:...")` without silent fallbacks.
- No blockers for remaining Phase 12 plans.

## Self-Check: PASSED

- File `apps/admin/src/lib/i18n.ts` exists with expected content (verified by Read after edit).
- Commit `8052eef` present in `git log`.
- All grep acceptance criteria satisfied.
- No stubs introduced (this plan adds no UI, no data flow, no rendering paths — pure resource registration).
- No new threat surface introduced (static JSON bundling, no network/auth/file access changes).

---
*Phase: 12-i18n-string-cleanup*
*Completed: 2026-04-14*
