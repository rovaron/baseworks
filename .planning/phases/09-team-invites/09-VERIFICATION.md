---
phase: 09-team-invites
verified: 2026-04-11T15:30:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Open /dashboard/settings as an org admin and click 'Invite Team Member'"
    expected: "Dialog opens with email field, role selector (Admin/Member), and email/link mode toggle (Switch)"
    why_human: "UI layout, toggle behavior, and form interaction require visual inspection"
  - test: "Submit an email invitation in email mode with 'admin' role, then check pending invitations"
    expected: "Toast shows 'Invitation sent to <email>', invitation appears in pending list with Email badge, email received with accept link"
    why_human: "Email delivery requires live BullMQ + Resend/SMTP and cannot be verified statically"
  - test: "Click 'Generate Link' in link mode, copy the generated URL, open it in an incognito window"
    expected: "Branded invite card shows org name, inviter name, assigned role, and Login/Create Account buttons when not logged in"
    why_human: "Multi-step flow across tabs and auth states requires runtime testing"
  - test: "Log in as a new user via the signup page navigated to with ?invite=TOKEN&email=user@test.com"
    expected: "Email pre-filled, after signup user lands directly in /dashboard with the invited org selected (NOT redirected to /invite/[token])"
    why_human: "D-08 auto-accept flow requires live auth session creation and organization setActive call"
  - test: "Accept an invite as a logged-in user on /invite/[token]"
    expected: "Clicking Accept redirects to /dashboard with the new org auto-selected as active tenant"
    why_human: "Pitfall 3 (setActive after acceptInvitation) requires live session to verify org context switch"
  - test: "Cancel a pending invitation from the settings page, then try to open the invite URL"
    expected: "Invite URL shows 'This invitation is no longer valid' error state"
    why_human: "Cancel + invalid state flow requires live API and database"
  - test: "As a Member (not admin), verify the Invite button is absent or blocked"
    expected: "Members should not see or be able to trigger invitations (D-16 RBAC)"
    why_human: "Role-based UI visibility requires testing with different user sessions"
---

# Phase 9: Team Invites Verification Report

**Phase Goal:** Organization admins can invite users to their team with role assignment, and invited users can accept via email link or shareable URL
**Verified:** 2026-04-11T15:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Org admin can invite by email with role (INVT-01) | VERIFIED | `auth.ts` has `sendInvitationEmail` callback; `routes.ts` POST /api/invitations accepts `{email, role, mode}`; `InviteDialog` sends via `api.api.invitations.post()`; `createInvitation` command wraps `auth.api.createInvitation` |
| 2 | Invited user receives email via BullMQ queue (INVT-02) | VERIFIED | `auth.ts` lines 101-109: `queue.add("team-invite", {to, template, data})` in `sendInvitationEmail` callback; `team-invite.tsx` template exported and registered in `send-email.ts` templates + subjects maps |
| 3 | Admin can generate shareable invite link with no email sent (INVT-03) | VERIFIED | `create-invitation.ts` generates `link-invite-${nanoid(10)}@internal` for link mode; `auth.ts` line 93: `if (data.email.endsWith("@internal")) { return; }` suppresses email; `InviteDialog` has Switch toggle; `PendingInvitations` detects type via `isLinkInvite = email.endsWith("@internal")` |
| 4 | Invited user can accept invite and join org (INVT-04) | VERIFIED | `invite/[token]/page.tsx`: `auth.organization.acceptInvitation + setActive` (logged-in state); login page preserves `?invite=` param and redirects to `/invite/${token}` after auth; signup page auto-accepts: `acceptInvitation -> fetch org -> setActive -> /dashboard` (D-08) |
| 5 | Admin can view, cancel, and resend pending invitations (INVT-05) | VERIFIED | `PendingInvitations`: `useQuery(["invitations"])` fetches from `api.api.invitations.get()`; cancel via DELETE; resend via POST `/:id/resend`; routes.ts has all endpoints behind `requireRole("owner","admin")` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/modules/auth/src/__tests__/invitation.test.ts` | Test scaffold with 18 todo stubs | VERIFIED | 18 `test.todo()` stubs across 5 INVT describe blocks; runs clean (0 pass, 18 todo, 0 fail) |
| `packages/modules/auth/src/auth.ts` | `sendInvitationEmail` callback + `invitationExpiresIn` + @internal suppression | VERIFIED | Line 88: `invitationExpiresIn: 315360000`; line 89: `sendInvitationEmail: async (data)`; line 93: @internal suppression guard |
| `packages/modules/billing/src/templates/team-invite.tsx` | React Email template for team invitations | VERIFIED | Exports `TeamInviteEmail` with `inviteLink`, `organizationName`, `inviterName`, `role` props |
| `packages/modules/billing/src/jobs/send-email.ts` | `team-invite` template registered | VERIFIED | Line 7: import; line 14: template entry; line 22: subject entry |
| `packages/i18n/src/locales/en/invite.json` | English invite translations | VERIFIED | All 9 sections present: settings, members, pending, dialog, roles, actions, toast, accept, cancel |
| `packages/i18n/src/locales/pt-BR/invite.json` | Portuguese invite translations | VERIFIED | Same 9 sections in pt-BR |
| `packages/i18n/src/index.ts` | `invite` namespace registered | VERIFIED | Line 5: `"invite"` in namespaces array; lines 14, 22: enInvite + ptBRInvite exports |
| `packages/ui/src/components/switch.tsx` | Switch component installed | VERIFIED | Exists at `packages/ui/src/components/switch.tsx`; exported via `packages/ui/src/index.ts` line 17 |
| `packages/modules/auth/src/commands/create-invitation.ts` | Create invitation with email/link mode | VERIFIED | Exports `createInvitation`; line 37: `link-invite-${nanoid(10)}@internal` for link mode; `mode` field in TypeBox schema |
| `packages/modules/auth/src/commands/accept-invitation.ts` | Accept invitation command | VERIFIED | Exports `acceptInvitation`; calls `auth.api.acceptInvitation`; emits `invitation.accepted` |
| `packages/modules/auth/src/commands/reject-invitation.ts` | Reject invitation command | VERIFIED | Exports `rejectInvitation`; calls `auth.api.rejectInvitation`; emits `invitation.rejected` |
| `packages/modules/auth/src/commands/cancel-invitation.ts` | Cancel invitation command | VERIFIED | Exports `cancelInvitation`; calls `auth.api.cancelInvitation`; emits `invitation.cancelled` |
| `packages/modules/auth/src/queries/list-invitations.ts` | List pending invitations | VERIFIED | Exports `listInvitations`; calls `auth.api.listInvitations` with `organizationId` |
| `packages/modules/auth/src/queries/get-invitation.ts` | Get single invitation (public) | VERIFIED | Exports `getInvitation`; calls `auth.api.getInvitation`; no auth required |
| `packages/modules/auth/src/index.ts` | Module registration with all commands/queries/events | VERIFIED | 4 command keys, 2 query keys, 4 event names all registered |
| `packages/modules/auth/src/routes.ts` | HTTP endpoints for invitation CRUD | VERIFIED | Public GET /api/invitations/:id outside auth group; protected POST/GET/DELETE/POST-resend with `requireRole("owner","admin")` |
| `apps/web/app/(dashboard)/dashboard/settings/page.tsx` | Settings page with Team tab | VERIFIED | `"use client"`, Suspense, nuqs tab state, `useTranslations("invite")`, MembersList + PendingInvitations + InviteDialog rendered |
| `apps/web/components/members-list.tsx` | Current members with role badges | VERIFIED | Exports `MembersList`; `useQuery` fetches via `auth.organization.getFullOrganization`; Table + Avatar + Badge with role variants; `useTranslations("invite")` |
| `apps/web/components/pending-invitations.tsx` | Pending invitations with cancel/resend | VERIFIED | Exports `PendingInvitations`; `isLinkInvite` checks `@internal` suffix; cancel + resend mutations; Tooltip-wrapped action buttons; `useTranslations("invite")` |
| `apps/web/components/invite-dialog.tsx` | Invite dialog with email/link mode toggle | VERIFIED | Exports `InviteDialog`; Switch mode toggle; email + role inputs; `useMutation` to `api.api.invitations.post`; `CopyLinkButton` for link mode; `Loader2` spinner |
| `apps/web/components/copy-link-button.tsx` | Copy-to-clipboard button | VERIFIED | Exports `CopyLinkButton`; `navigator.clipboard.writeText`; `aria-live="polite"` |
| `apps/web/app/(auth)/invite/[token]/page.tsx` | Public invite accept/decline page | VERIFIED | Exports default `InviteAcceptPage`; 5 states handled (loading skeleton, logged-in accept/decline, not-logged-in login/signup, invalid token, already-member); `useTranslations("invite")`; `setActive` called after accept (Pitfall 3) |
| `apps/web/app/(auth)/login/page.tsx` | Login page with invite token preservation | VERIFIED | `searchParams.get("invite")`; post-login redirects to `/invite/${inviteToken}` |
| `apps/web/app/(auth)/signup/page.tsx` | Signup with invite auto-accept | VERIFIED | `searchParams.get("invite")` and `searchParams.get("email")`; email pre-fill; auto-accept: `acceptInvitation -> setActive -> /dashboard` (D-08 honored) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `auth.ts` sendInvitationEmail | BullMQ email queue | `queue.add("team-invite", ...)` | WIRED | Lines 101-109 in auth.ts |
| `auth.ts` sendInvitationEmail | @internal suppression | `data.email.endsWith("@internal")` early return | WIRED | Line 93 in auth.ts |
| `send-email.ts` | `team-invite.tsx` template | `import { TeamInviteEmail }` + templates map | WIRED | Lines 7, 14, 22 |
| `create-invitation.ts` | `auth.api.createInvitation` | Direct call with email/role/organizationId | WIRED | Line 40 |
| `create-invitation.ts` | @internal suppression contract | `link-invite-${nanoid(10)}@internal` for link mode | WIRED | Line 37 |
| `routes.ts` | `requireRole("owner","admin")` middleware | `.use(requireRole("owner", "admin"))` in group | WIRED | Line 64 |
| `routes.ts` | Public GET /api/invitations/:id | Placed outside auth group, before `.group()` | WIRED | Lines 46-59 |
| `settings/page.tsx` | `/api/invitations` | `api.api.invitations.post()` via InviteDialog + `api.api.invitations.get()` via PendingInvitations | WIRED | Eden Treaty client in components |
| `invite/[token]/page.tsx` | `auth.organization.acceptInvitation` | Direct call in accept handler | WIRED | Line 94 |
| `invite/[token]/page.tsx` | `auth.organization.setActive` | Called after acceptInvitation (Pitfall 3 honored) | WIRED | Lines 94-96 |
| `signup/page.tsx` | `auth.organization.acceptInvitation` | Auto-accept in signup success handler | WIRED | Line 72 |
| `login/page.tsx` | `/invite/${inviteToken}` | Post-login redirect with token | WIRED | Lines 64-65 |
| `pending-invitations.tsx` | @internal type detection | `isLinkInvite = email.endsWith("@internal")` | WIRED | Line 32 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `pending-invitations.tsx` | `invitations` array | `api.api.invitations.get()` -> GET /api/invitations -> `listInvitations` query -> `auth.api.listInvitations` | Yes — delegated to better-auth DB query | FLOWING |
| `members-list.tsx` | `members` array | `auth.organization.getFullOrganization()` -> better-auth API | Yes — fetches org with members from DB | FLOWING |
| `invite/[token]/page.tsx` | `invitation` object | `fetch(NEXT_PUBLIC_API_URL/api/invitations/${token})` -> GET /api/invitations/:id -> `getInvitation` -> `auth.api.getInvitation` | Yes — real DB lookup by invitation ID | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test scaffold runs without hard failures | `bun test packages/modules/auth/src/__tests__/invitation.test.ts` | 0 pass, 18 todo, 0 fail | PASS |
| createInvitation exports correctly | `grep "^export const createInvitation" packages/modules/auth/src/commands/create-invitation.ts` | Found at line 28 | PASS |
| Switch UI component exported | `grep "switch" packages/ui/src/index.ts` | `export * from "./components/switch"` at line 17 | PASS |
| invite i18n namespace registered | `grep '"invite"' packages/i18n/src/index.ts` | Found in namespaces array | PASS |
| Email suppression guard present | `grep 'endsWith.*@internal' packages/modules/auth/src/auth.ts` | Found at line 93 | PASS |
| Public route placed before protected group | Routes structure inspection | GET /api/invitations/:id at line 46, group at line 61 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INVT-01 | Plans 01, 02, 03 | Org admin can invite a user by email with a role (admin/member) | SATISFIED | auth.ts callback + createInvitation command + InviteDialog email mode |
| INVT-02 | Plan 01 | Invited user receives email with accept/decline link | SATISFIED | sendInvitationEmail -> queue.add("team-invite") -> TeamInviteEmail template with inviteLink |
| INVT-03 | Plans 01, 02, 03 | Org admin can generate a shareable invite link with a role | SATISFIED | link mode with @internal placeholder + email suppression + InviteDialog link mode UI |
| INVT-04 | Plans 02, 04 | Invited user can accept invite and join the organization (existing or new account) | SATISFIED | invite/[token]/page.tsx + login invite token preservation + signup auto-accept |
| INVT-05 | Plans 02, 03 | Org admin can view, cancel, and resend pending invitations from management page | SATISFIED | PendingInvitations component + cancel/resend mutations + routes DELETE + POST resend |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `members-list.tsx` | 68 | `if (!activeTenant?.id) return []` | Info | Safe early return — prevents queries without tenant context, not a stub |
| `invitation.test.ts` | 14-43 | `test.todo()` stubs | Info | Intentional Wave 0 TDD scaffold — all tests are todos, none are implementations. Backend CQRS is verified via grep/file checks. Full test implementation was not planned for this phase. |

No blocker anti-patterns found. The `test.todo()` stubs are the expected state for this phase's Wave 0 test scaffold.

### Human Verification Required

#### 1. Invite Dialog UI and Form Behavior

**Test:** Log in as an org admin, navigate to /dashboard/settings, click "Invite Team Member"
**Expected:** Dialog opens showing email input, role selector (Admin/Member only — no Owner), and a Switch toggle between Email and Link mode. In email mode the submit button reads "Send Invite". In link mode it reads "Generate Link" and the email field is hidden.
**Why human:** Form layout, Switch interaction, and conditional field visibility require visual testing

#### 2. Email Delivery End-to-End

**Test:** Send an email invitation, check the recipient's inbox
**Expected:** Email arrives with org name, inviter name, assigned role, and "Accept Invitation" CTA button linking to `/invite/{invitationId}`
**Why human:** BullMQ + Resend/SMTP must be running; email delivery cannot be asserted statically

#### 3. Shareable Link Flow

**Test:** Generate a shareable link in the invite dialog, copy it, open in incognito
**Expected:** /invite/{token} page shows branded card with org name, inviter name, role badge, and "Log in to Accept" + "Create Account to Join" buttons
**Why human:** Public page rendering with real invitation data requires live API

#### 4. Signup Auto-Accept (D-08)

**Test:** Open /signup?invite=TOKEN&email=newuser@test.com as a new user, complete signup
**Expected:** Email field is pre-filled; after signup user lands directly at /dashboard with the invited org already active — they NEVER see the /invite/[token] page manually
**Why human:** Requires live session creation, acceptInvitation, setActive, and org context switch

#### 5. Post-Accept Org Activation (D-09, Pitfall 3)

**Test:** Accept an invitation as a logged-in user on the invite page
**Expected:** Dashboard loads with the new org selected in the tenant dropdown (not the user's previous active org)
**Why human:** `setActive` side effect and tenant context switch require live runtime verification

#### 6. Cancel + Invalid Token State

**Test:** Cancel a pending invitation from settings, then navigate to the invite URL
**Expected:** /invite/[token] shows "This invitation is no longer valid" error card with "Go to Home" link
**Why human:** Requires live cancel API call + page reload to test status transition

#### 7. RBAC: Members Cannot Invite (D-16)

**Test:** Log in as a Member (not admin/owner) and navigate to /dashboard/settings
**Expected:** Either the Invite Team Member button is absent, or clicking it returns an error (server enforces via requireRole)
**Why human:** Role-based UI visibility requires testing with a Member-role session

### Gaps Summary

No automated gaps found. All 5 INVT requirements are implemented with:
- Substantive artifacts (no stubs or empty implementations)
- Wired data flows (Eden Treaty client -> Elysia routes -> CQRS -> auth.api -> better-auth DB)
- Key contracts honored: @internal email suppression, invitationExpiresIn ~10 years (D-11), requireRole RBAC (D-16), setActive after accept (Pitfall 3), D-08 auto-accept on signup

7 human verification items block the `passed` status. These cover the user-visible flows, email delivery, and session-dependent behavior that cannot be asserted programmatically.

---

_Verified: 2026-04-11T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
