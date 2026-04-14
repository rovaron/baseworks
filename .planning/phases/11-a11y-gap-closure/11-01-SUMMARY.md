---
phase: 11-a11y-gap-closure
plan: 01
subsystem: ui
tags: [accessibility, a11y, nextjs, semantic-html, heading-hierarchy, invite]

requires:
  - phase: 09-team-invites
    provides: invite accept page
  - phase: 07-accessibility
    provides: canonical auth-page h1 className pattern
provides:
  - "Invite accept page now renders <h1> at the top of every card state"
  - "Closes A11Y-01 heading hierarchy gap flagged by v1.1 milestone audit"
affects: [12-i18n-cleanup, v1.1-milestone-close, audit-rerun]

tech-stack:
  added: []
  patterns:
    - "Auth-page h1: text-2xl font-semibold leading-none tracking-tight"

key-files:
  created: []
  modified:
    - apps/web/app/(auth)/invite/[token]/page.tsx

key-decisions:
  - "Inline <h1> elements (matching login/page.tsx pattern) rather than introducing a local heading wrapper"
  - "All 5 card states get an <h1> — every state is the top-of-page user encounters"
  - "Preserved mt-4 layout spacing where CardTitle had it (3 of 5 states)"

patterns-established:
  - "Auth Card pages use inline <h1 className='text-2xl font-semibold leading-none tracking-tight'> instead of <CardTitle> when the title is the page's primary heading"

requirements-completed: [A11Y-01]

duration: 3min
completed: 2026-04-14
---

# Phase 11 Plan 01: Invite Accept Page Heading Hierarchy Summary

**Replaced 5 `<CardTitle>` usages with `<h1>` on the invite accept page, closing the A11Y-01 heading hierarchy regression flagged by the v1.1 milestone audit.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-14T01:20:20Z
- **Completed:** 2026-04-14T01:23:32Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Removed `CardTitle` import from `apps/web/app/(auth)/invite/[token]/page.tsx`
- Replaced all 5 `<CardTitle>` usages (loading-invalid, already-member, declined, logged-in-accept, not-logged-in card states) with semantic `<h1>` elements
- Mirrored the canonical auth-page heading className from `apps/web/app/(auth)/login/page.tsx:85` (`text-2xl font-semibold leading-none tracking-tight`) — visual parity preserved
- Preserved `mt-4` layout spacing on the 3 card states that originally had it (invalid, logged-in accept, not-logged-in)
- A11Y-01 partial regression flagged by the v1.1 milestone audit is now closed for the invite accept page

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace all 5 CardTitle usages with h1 and drop CardTitle import** - `d554611` (fix)

## Files Created/Modified
- `apps/web/app/(auth)/invite/[token]/page.tsx` — Removed CardTitle import; replaced 5 `<CardTitle>` instances with `<h1 className="text-2xl font-semibold leading-none tracking-tight">` (with `mt-4` preserved on the 3 sites that had it)

## Decisions Made
- None new — followed the plan's locked decisions and the audit's gap closure direction. All choices (inline h1, all 5 card states, preserve mt-4, drop CardTitle import) were already specified in the plan.

## Deviations from Plan

None — plan executed exactly as written. The only execution-time observation:
- The plan's `verify` block calls `bun run --filter=@baseworks/web typecheck`, but `apps/web/package.json` does not define a `typecheck` script. Used `bunx tsc --noEmit` from `apps/web` instead. The file I edited produced zero TypeScript errors. All other reported errors are pre-existing in unrelated files (api modules, components/invite-dialog.tsx [scope of plan 11-02], pending-invitations.tsx, billing page, packages/ui/switch.tsx) and are out of scope per the deviation rules' SCOPE BOUNDARY clause.

## Issues Encountered

- **Pre-existing test runner mismatch:** Running `bun test` at the repo root attempts to execute `packages/ui/src/components/__tests__/*.test.tsx` files, which fail with `ReferenceError: document is not defined` because they require jsdom (only available via vitest). This is a pre-existing repo configuration issue unrelated to Plan 11-01. Verified the regression-relevant `form.a11y.test.tsx` (and all 9 packages/ui test files) by running `bunx vitest run` from `packages/ui` instead — **all 20 tests pass**, confirming no regression and confirming the upstream `FormMessage` `role="alert"` guarantee that Phase 11-02 will rely on.

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -c "CardTitle" apps/web/app/(auth)/invite/[token]/page.tsx` | 0 | 0 | PASS |
| `grep -c '<h1' apps/web/app/(auth)/invite/[token]/page.tsx` | 5 | 5 | PASS |
| `grep -c "text-2xl font-semibold leading-none tracking-tight" apps/web/app/(auth)/invite/[token]/page.tsx` | 5 | 5 | PASS |
| `tsc --noEmit` errors in modified file | 0 | 0 | PASS |
| `packages/ui` vitest suite | pass | 20/20 pass | PASS |

## User Setup Required

None — pure presentational refactor. No env vars, no infra, no dashboard config.

## Next Phase Readiness
- Plan 11-02 (InviteDialog Form primitive refactor) is unblocked — operates on a different file (`apps/web/components/invite-dialog.tsx`).
- Once Plan 11-02 lands, the v1.1 audit can re-run and flip A11Y-01, A11Y-04, A11Y-05 from partial to satisfied.

## Self-Check: PASSED

- File modified exists: `apps/web/app/(auth)/invite/[token]/page.tsx` — FOUND
- Commit `d554611` — FOUND in `git log --oneline -5`
- All grep assertions pass
- Acceptance criteria satisfied
- packages/ui vitest suite green (no regression)

---
*Phase: 11-a11y-gap-closure*
*Completed: 2026-04-14*
