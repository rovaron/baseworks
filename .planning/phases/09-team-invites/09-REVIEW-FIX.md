---
phase: 09-team-invites
fixed_at: 2026-04-11T00:00:00Z
review_path: .planning/phases/09-team-invites/09-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 09: Code Review Fix Report

**Fixed at:** 2026-04-11T00:00:00Z
**Source review:** .planning/phases/09-team-invites/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: Open-redirect via unsanitized `inviteToken` query parameter

**Files modified:** `apps/web/lib/invite.ts`, `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/signup/page.tsx`
**Commit:** dd6632b
**Applied fix:** Created `sanitizeInviteToken()` utility that validates invite tokens against `/^[a-zA-Z0-9_-]{10,40}$/` regex. Applied sanitization in both login and signup pages where `inviteToken` is read from `useSearchParams()`, preventing path traversal and open-redirect attacks via crafted invite parameters.

### CR-02: Resend creates a new invitation without cancelling the original, producing orphaned records

**Files modified:** `packages/modules/auth/src/routes.ts`
**Commit:** 599db95
**Applied fix:** Added a `cancelInvitation()` call in the resend handler that cancels the original invitation before creating the replacement. If cancellation fails, the handler returns a 400 error and does not create a new invitation, preventing orphaned records.

### WR-01: Clipboard write failure silently dropped in `CopyLinkButton`

**Files modified:** `apps/web/components/copy-link-button.tsx`
**Commit:** d88d3a4
**Applied fix:** Wrapped `navigator.clipboard.writeText()` and subsequent state updates in a try-catch block so that clipboard permission failures, HTTP context issues, or unfocused-page errors do not cause unhandled promise rejections or misleading "Copied!" UI state.

### WR-02: `api.api.invitations.post(values as any)` bypasses body type validation

**Files modified:** `apps/web/components/invite-dialog.tsx`
**Commit:** 16abf17
**Applied fix:** Removed the `as any` cast. Built a typed `payload` object that conditionally includes `email` only in email mode (omitted entirely in link mode), then passes it directly to the Eden Treaty call without type circumvention.

### WR-03: Link-invite URL constructed from speculative fallback `data?.data?.id ?? data?.id`

**Files modified:** `apps/web/components/invite-dialog.tsx`
**Commit:** ab75829
**Applied fix:** Pinned to `(data as any)?.data?.id` (the server envelope shape) and added a guard that shows an error toast and returns early if `invitationId` is falsy, preventing construction of invalid invite URLs.

### WR-04: `acceptInvitation` and `rejectInvitation` commands pass `new Headers()` instead of caller's session

**Files modified:** `packages/modules/auth/src/commands/accept-invitation.ts`, `packages/modules/auth/src/commands/reject-invitation.ts`
**Commit:** 2ae052e
**Applied fix:** Changed both commands to use `ctx.headers ?? new Headers()` so that when invoked from a route handler with a real session context, the caller's authentication headers are forwarded to better-auth's API. Falls back to empty headers for backward compatibility.

### WR-05: `resendMutation` spinner shows for all rows when any row is loading

**Files modified:** `apps/web/components/pending-invitations.tsx`
**Commit:** fec58ee
**Applied fix:** Added `resendingId` state to track which specific invitation is being resent. The `mutationFn` sets this ID before the API call, `onSettled` clears it. Row rendering now compares `resendingId === invitation.id` for both the `disabled` prop and spinner/icon toggle, so only the active row shows loading state.

---

_Fixed: 2026-04-11T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
