---
status: partial
phase: 09-team-invites
source: [09-VERIFICATION.md]
started: 2026-04-11T14:20:00Z
updated: 2026-04-11T14:20:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Invite Dialog UI behavior
expected: Switch toggle shows email field / hides for link mode, form validation works correctly
result: [pending]

### 2. Email delivery end-to-end
expected: BullMQ + Resend delivers team invite email with correct org name, inviter, role, and accept link
result: [pending]

### 3. Shareable link flow
expected: Public /invite/[token] page renders correctly for unauthenticated users with live API data
result: [pending]

### 4. Signup auto-accept (D-08)
expected: New user signing up via invite link auto-accepts invitation and lands on /dashboard without visiting /invite/[token]
result: [pending]

### 5. Post-accept org activation (D-09, Pitfall 3)
expected: After accepting invitation, user's active org context switches to the invited org
result: [pending]

### 6. Cancel + invalid token state
expected: Cancelled invitations show invalid/expired state, token no longer usable
result: [pending]

### 7. RBAC: Members cannot invite (D-16)
expected: Users with Member role cannot access invite functionality, server rejects with 403
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
