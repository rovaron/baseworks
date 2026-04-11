---
phase: 09-team-invites
plan: 01
subsystem: auth
tags: [better-auth, email, react-email, i18n, shadcn, bullmq]

# Dependency graph
requires:
  - phase: 08-i18n
    provides: i18n infrastructure with namespaces, next-intl, react-i18next
provides:
  - sendInvitationEmail callback with @internal email suppression for link mode
  - TeamInviteEmail React Email template registered in email handler
  - invitationExpiresIn set to ~10 years (effectively no expiration per D-11)
  - invite i18n namespace with en and pt-BR translations covering full invite UI
  - Switch component exported from @baseworks/ui
affects: [09-02, 09-03, 09-04, 09-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@internal email suffix suppression contract for link-mode invitations"

key-files:
  created:
    - packages/modules/billing/src/templates/team-invite.tsx
    - packages/i18n/src/locales/en/invite.json
    - packages/i18n/src/locales/pt-BR/invite.json
  modified:
    - packages/modules/auth/src/auth.ts
    - packages/modules/billing/src/jobs/send-email.ts
    - packages/i18n/src/index.ts
    - packages/ui/src/index.ts

key-decisions:
  - "Switch component installed at src/components/ (shadcn default for this project), not src/components/ui/"
  - "@internal email suffix chosen as the suppression contract between sendInvitationEmail callback and link-mode invite creation"

patterns-established:
  - "@internal email suppression: sendInvitationEmail checks email.endsWith('@internal') and skips enqueueing for link-mode invitations"

requirements-completed: [INVT-01, INVT-02]

# Metrics
duration: 3min
completed: 2026-04-11
---

# Phase 9 Plan 01: Backend Invite Infrastructure Summary

**sendInvitationEmail callback with @internal link-mode suppression, TeamInviteEmail template via BullMQ, invite i18n namespace (en/pt-BR), and Switch UI component**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-11T13:57:42Z
- **Completed:** 2026-04-11T14:00:46Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Wired sendInvitationEmail callback in better-auth org plugin that enqueues team-invite email via BullMQ, with @internal email suffix suppression for shareable link mode
- Created TeamInviteEmail React Email template rendering org name, inviter name, role, and accept CTA button
- Registered team-invite template and subject in email job handler
- Set invitationExpiresIn to 315360000 seconds (~10 years) to effectively disable expiration per D-11
- Created full invite i18n namespace with en and pt-BR translations covering settings, members, pending, dialog, roles, actions, toast, accept, and cancel sections
- Installed and exported Switch component from @baseworks/ui for invite dialog mode toggle

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire sendInvitationEmail callback with @internal suppression, email template, and email handler registration** - `526bcac` (feat)
2. **Task 2: Create invite i18n namespace and install Switch component** - `9728ab4` (feat)

## Files Created/Modified
- `packages/modules/auth/src/auth.ts` - Added sendInvitationEmail callback with @internal suppression and invitationExpiresIn config
- `packages/modules/billing/src/templates/team-invite.tsx` - New React Email template for team invitations
- `packages/modules/billing/src/jobs/send-email.ts` - Registered team-invite template and subject
- `packages/i18n/src/locales/en/invite.json` - English invite translations (all UI strings)
- `packages/i18n/src/locales/pt-BR/invite.json` - Portuguese invite translations
- `packages/i18n/src/index.ts` - Added invite namespace and exports
- `packages/ui/src/index.ts` - Added Switch component export
- `packages/ui/src/components/switch.tsx` - shadcn Switch component (auto-generated)

## Decisions Made
- Switch component installed at `src/components/switch.tsx` (shadcn's configured path for this project) rather than `src/components/ui/switch.tsx` as mentioned in plan -- consistent with all other components in the project
- Used `data.inviter.user.name || data.inviter.user.email` as fallback for inviterName in case user has no display name

## Deviations from Plan

None - plan executed exactly as written. The Switch component path difference is a project convention, not a deviation.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Email infrastructure ready: auth.ts callback -> BullMQ queue -> send-email handler -> team-invite template
- @internal email suppression contract established for Plan 02 link-mode invitations
- All invite UI translation keys available for Plans 03-05
- Switch component available for invite dialog mode toggle in Plan 03

## Self-Check: PASSED

All created files verified on disk. Both task commits (526bcac, 9728ab4) found in git log.

---
*Phase: 09-team-invites*
*Completed: 2026-04-11*
