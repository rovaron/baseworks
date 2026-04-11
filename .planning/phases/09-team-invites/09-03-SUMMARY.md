---
phase: 09-team-invites
plan: 03
subsystem: ui
tags: [react, next-intl, react-query, react-hook-form, shadcn, settings, invite-dialog, members]

# Dependency graph
requires:
  - phase: 09-team-invites/01
    provides: invite i18n namespace (en/pt-BR), Switch component in @baseworks/ui
  - phase: 09-team-invites/02
    provides: invitation CQRS commands/queries and HTTP API routes
affects: [09-team-invites/04, 09-team-invites/05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Settings page with nuqs tab state following billing page canonical pattern"
    - "@internal email suffix detection in PendingInvitations for email-vs-link type display"
    - "InviteDialog dual-mode form with Switch toggle between email and link"

key-files:
  created:
    - apps/web/app/(dashboard)/dashboard/settings/page.tsx
    - apps/web/components/members-list.tsx
    - apps/web/components/pending-invitations.tsx
    - apps/web/components/invite-dialog.tsx
    - apps/web/components/copy-link-button.tsx
  modified: []

key-decisions:
  - "Used auth.organization.getFullOrganization for member data instead of separate API call"
  - "Used Dialog for cancel/remove confirmations since AlertDialog not available in @baseworks/ui"
  - "InviteDialog renders trigger Button inline (not as DialogTrigger) for simpler open/close state management with link-mode URL display"

patterns-established:
  - "Settings page pattern: nuqs tab state, Team tab with MembersList + PendingInvitations + InviteDialog"
  - "Copy-to-clipboard pattern: CopyLinkButton with 2s visual feedback"
  - "Invitation type detection: isLinkInvite = email.endsWith('@internal')"

requirements-completed: [INVT-01, INVT-03, INVT-05]

# Metrics
duration: 3min
completed: 2026-04-11
---

# Phase 9 Plan 03: Settings Team Tab UI Summary

**Settings page with Team tab containing members list, invite dialog with email/link mode toggle, and pending invitations with cancel/resend actions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-11T14:08:48Z
- **Completed:** 2026-04-11T14:12:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created Settings page at /dashboard/settings with Team tab following billing page canonical pattern (Suspense, nuqs tabs, useTranslations)
- MembersList shows org members with initials-based avatars, role badges (Owner=outline, Admin=secondary, Member=default), and dropdown remove action with confirmation
- InviteDialog supports dual mode: email sends invitation and closes, link generates URL shown inline with CopyLinkButton
- PendingInvitations table detects email-vs-link type via @internal suffix contract, shows resend (email only) and cancel actions with tooltips and confirmation dialog

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Settings page with Team tab, MembersList, and CopyLinkButton** - `11a99c1` (feat)
2. **Task 2: Create InviteDialog and PendingInvitations components** - `80b3965` (feat)

## Files Created/Modified
- `apps/web/app/(dashboard)/dashboard/settings/page.tsx` - Settings page with Team tab, MembersList, PendingInvitations, InviteDialog
- `apps/web/components/members-list.tsx` - Org members table with avatars, role badges, remove action
- `apps/web/components/copy-link-button.tsx` - Clipboard copy button with visual feedback
- `apps/web/components/invite-dialog.tsx` - Invite dialog with email/link mode toggle, form validation, URL generation
- `apps/web/components/pending-invitations.tsx` - Pending invitations table with @internal type detection, cancel/resend

## Decisions Made
- Used `auth.organization.getFullOrganization()` to fetch members data since `useActiveOrganization` may not include full member list with user details
- Used Dialog (not AlertDialog) for cancel/remove confirmations since AlertDialog is not available in `@baseworks/ui`
- InviteDialog manages its own open state rather than using DialogTrigger to support the link-mode post-submit URL display flow

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Settings Team tab fully built and ready for the invite accept page (Plan 04)
- All components use the invite i18n namespace and Eden Treaty API client
- CopyLinkButton is reusable for any copy-to-clipboard need

## Self-Check: PASSED
