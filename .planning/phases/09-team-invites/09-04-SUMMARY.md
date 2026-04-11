---
phase: 09-team-invites
plan: 04
subsystem: ui
tags: [next-intl, react-query, better-auth, invite-accept, auto-accept]

# Dependency graph
requires:
  - phase: 09-team-invites/01
    provides: invite i18n namespace (en/pt-BR) with accept/decline keys
  - phase: 09-team-invites/02
    provides: public GET /api/invitations/:id endpoint and better-auth client SDK methods
provides:
  - "Invite accept page at /invite/[token] with 5 user states (loading, logged-in, not-logged-in, invalid, already-member)"
  - "Login page invite token preservation via ?invite= query param"
  - "Signup page auto-accept on account creation per D-08 (acceptInvitation -> setActive -> dashboard)"
  - "Email pre-fill on signup from ?email= query param"
affects: [09-team-invites/05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Invite token preservation through auth flow via query params"
    - "Auto-accept pattern: signup success -> acceptInvitation -> fetch invitation -> setActive -> redirect"

key-files:
  created:
    - apps/web/app/(auth)/invite/[token]/page.tsx
  modified:
    - apps/web/app/(auth)/login/page.tsx
    - apps/web/app/(auth)/signup/page.tsx

key-decisions:
  - "Used Dialog (not AlertDialog) for decline confirmation since AlertDialog is not in @baseworks/ui"
  - "OAuth callbackURL also respects invite token for consistent flow across all login methods"
  - "Not-logged-in state shows both Login and Create Account options since server cannot determine if user has an account"

patterns-established:
  - "Query param token preservation: invite page -> /login?invite=X -> /invite/X after auth"
  - "Auto-accept on signup: signup success handler calls acceptInvitation + setActive inline, never redirects to /invite/[token]"

requirements-completed: [INVT-04]

# Metrics
duration: 3min
completed: 2026-04-11
---

# Phase 9 Plan 04: Invite Accept Page & Auth Flow Integration Summary

**Public invite accept page with 5 user states, login redirect with token preservation, and signup auto-accept per D-08**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-11T14:09:02Z
- **Completed:** 2026-04-11T14:11:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created invite accept page at /invite/[token] with loading skeleton, logged-in accept/decline, not-logged-in login/signup options, invalid token error, and already-a-member states
- Wired login page to detect ?invite= param and redirect to /invite/[token] after authentication (including OAuth flows)
- Implemented D-08 auto-accept: signup with invite token calls acceptInvitation -> setActive -> redirects to dashboard without ever showing invite page

## Task Commits

Each task was committed atomically:

1. **Task 1: Create invite accept page with all 5 user states** - `221e839` (feat)
2. **Task 2: Wire login and signup pages to handle invite query param with auto-accept on signup** - `debb482` (feat)

## Files Created/Modified
- `apps/web/app/(auth)/invite/[token]/page.tsx` - Public invite accept/decline page with 5 states, useTranslations('invite'), Avatar/Badge/Card UI
- `apps/web/app/(auth)/login/page.tsx` - Added invite token detection and post-login redirect to /invite/[token]
- `apps/web/app/(auth)/signup/page.tsx` - Added invite/email param detection, email pre-fill, and auto-accept on signup success

## Decisions Made
- Used Dialog component for decline confirmation instead of AlertDialog (AlertDialog not available in @baseworks/ui)
- OAuth callbackURL dynamically set based on invite token presence for consistent behavior across email and social login
- Both Login and Create Account buttons shown for not-logged-in users since the client cannot determine account existence without authentication

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Invite accept page fully functional for all 3 user journeys (logged in, existing account, new user)
- Token preservation through login/signup flow verified in code structure
- Auto-accept on signup wired with proper error handling (graceful fallback to dashboard)
- Ready for Plan 05 (integration testing / verification)

## Self-Check: PASSED

- FOUND: apps/web/app/(auth)/invite/[token]/page.tsx
- FOUND: apps/web/app/(auth)/login/page.tsx
- FOUND: apps/web/app/(auth)/signup/page.tsx
- FOUND: commit 221e839
- FOUND: commit debb482

---
*Phase: 09-team-invites*
*Completed: 2026-04-11*
