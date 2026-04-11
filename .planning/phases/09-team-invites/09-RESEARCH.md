# Phase 9: Team Invites - Research

**Researched:** 2026-04-10
**Domain:** better-auth organization invitations, CQRS command/query patterns, React Email templates, Next.js public/protected pages
**Confidence:** HIGH

## Summary

Phase 9 implements team invitation functionality on top of better-auth's organization plugin, which already provides the full invitation lifecycle: create, accept, reject, cancel, and list invitations. The `invitation` table already exists in the Drizzle schema with id, organizationId, email, role, status, expiresAt, and inviterId columns. The auth client (`organizationClient()`) is already wired on the frontend. This means the backend work is primarily wiring the `sendInvitationEmail` callback into the existing better-auth config and adding CQRS commands/queries that delegate to `auth.api.*` methods -- the same pattern used for tenant CRUD.

The frontend work involves two new page groups: (1) a settings page at `/dashboard/settings` with a Team tab for member listing, invite dialog, and pending invitation management; and (2) a public invite acceptance page at `/invite/[token]` that handles three user states (logged in, has account but logged out, new user). The billing page (`/dashboard/billing`) provides the canonical pattern for dashboard pages with Tabs, useQuery, useMutation, Dialog, and useTranslations.

**Primary recommendation:** Leverage better-auth's built-in invitation API exclusively -- do NOT build custom invitation logic. Wire `sendInvitationEmail` callback to the existing email queue, create thin CQRS wrappers, and build the UI following established dashboard page patterns.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Invite management lives at `/dashboard/settings` with a "Team" tab -- sidebar already has a Settings link pointing there
- **D-02:** Settings page structured for future tabs (Profile, Preferences) but ships with Team tab only
- **D-03:** Team tab shows current members list + pending invitations list
- **D-04:** Single "Invite" button opens a dialog with email field + role selector + toggle between "Send email invite" and "Generate shareable link"
- **D-05:** Branded landing page at `/invite/[token]` showing org name, inviter name, assigned role, and Accept/Decline buttons
- **D-06:** If user is logged in, Accept/Decline processes immediately
- **D-07:** If user is not logged in but has an account, redirect to login with invite token preserved, auto-process on return
- **D-08:** If user has no account, show "Create account to join" with email pre-filled from invite, auto-accept on signup completion
- **D-09:** After accepting, user lands in the org dashboard with the org auto-selected as active tenant
- **D-10:** Shareable invite links are single-use -- each link works once, admin generates a new link per person
- **D-11:** No auto-expiration -- links stay active until manually revoked (INVT-06 deferred to v1.2)
- **D-12:** Admin can revoke (cancel) any pending invitation from the management page
- **D-13:** Two assignable roles: Admin and Member (Owner is the org creator, not assignable via invites)
- **D-14:** Owners can invite admins and members
- **D-15:** Admins can invite admins and members
- **D-16:** Members cannot invite anyone

### Claude's Discretion
- Exact invite dialog layout and form validation UX
- How invite token is preserved through login/signup redirect flow (query param, cookie, or localStorage)
- Email template design (follow existing password-reset template pattern)
- Whether to show member avatars or just names in the team list
- Admin dashboard integration (whether to add invite management to admin tenant detail page)
- Translation key structure for invite-related strings in packages/i18n

### Deferred Ideas (OUT OF SCOPE)
- **INVT-06: Configurable invite expiration** -- Already tracked in REQUIREMENTS.md as v1.2
- **Multi-use invite links** -- User chose single-use for v1.1; multi-use with limits could be a v1.2 enhancement
- **Admin dashboard invite management** -- Whether to add invite viewing/management to the admin tenant detail page (Claude's discretion for now)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INVT-01 | Org admin can invite a user by email with a role (admin/member) | better-auth `auth.api.createInvitation()` + `sendInvitationEmail` callback; CQRS command wrapping auth.api; Dialog UI with email + role selector |
| INVT-02 | Invited user receives email with accept/decline link | `sendInvitationEmail` callback wired to existing email queue; new React Email template following password-reset pattern; link format `/invite/[invitationId]` |
| INVT-03 | Org admin can generate a shareable invite link with a role | Same `auth.api.createInvitation()` but skip email sending; return the invitation ID for URL construction; UI toggle in invite dialog |
| INVT-04 | Invited user can accept invite and join the organization (existing or new account) | `auth.api.acceptInvitation()` / `auth.api.rejectInvitation()`; public `/invite/[token]` page with 3 user-state handling; `auth.organization.setActive()` after acceptance |
| INVT-05 | Org admin can view, cancel, and resend pending invitations from management page | `auth.api.listInvitations()` for listing; `auth.api.cancelInvitation()` for cancellation; resend via new `createInvitation` with same email + `resend: true` flag |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-auth | ^1.2+ | Invitation lifecycle API | Organization plugin already enabled with `createInvitation`, `acceptInvitation`, `rejectInvitation`, `cancelInvitation`, `getInvitation`, `listInvitations` [VERIFIED: codebase `packages/modules/auth/src/auth.ts`] |
| @react-email/components | ^0.0.25+ | Invite email template | Already used for password-reset and welcome emails [VERIFIED: codebase `packages/modules/billing/src/templates/`] |
| resend | ^4.0+ | Email delivery | Already wired via BullMQ email queue [VERIFIED: codebase `packages/modules/billing/src/jobs/send-email.ts`] |
| @tanstack/react-query | ^5.50+ | Data fetching for invite UI | Already used in all dashboard pages [VERIFIED: codebase billing page] |
| react-hook-form + zod | ^7.53+ / ^3.23+ | Invite dialog form | Already used in all auth forms [VERIFIED: codebase login page] |
| next-intl | installed | i18n for invite strings | Already wired in customer app [VERIFIED: Phase 8 completed] |

### No New Dependencies Required
This phase requires zero new package installations. All needed libraries are already in the monorepo. [VERIFIED: codebase inspection]

## Architecture Patterns

### New Files Structure
```
packages/
  modules/auth/src/
    commands/
      create-invitation.ts       # CQRS wrapper for auth.api.createInvitation
      accept-invitation.ts       # CQRS wrapper for auth.api.acceptInvitation
      reject-invitation.ts       # CQRS wrapper for auth.api.rejectInvitation
      cancel-invitation.ts       # CQRS wrapper for auth.api.cancelInvitation
    queries/
      list-invitations.ts        # CQRS wrapper for auth.api.listInvitations
      get-invitation.ts          # CQRS wrapper for auth.api.getInvitation
  modules/billing/src/
    templates/
      team-invite.tsx            # React Email template for invitation
  i18n/src/locales/
    en/invite.json               # English invite translation keys
    pt-BR/invite.json            # Portuguese invite translation keys
apps/web/
  app/(dashboard)/dashboard/settings/
    page.tsx                     # Settings page with Team tab
  app/(auth)/invite/[token]/
    page.tsx                     # Public invite accept/decline page
```

### Pattern 1: CQRS Command Wrapping better-auth API
**What:** Thin CQRS commands that delegate to `auth.api.*` -- identical to existing tenant commands
**When to use:** All invitation operations
**Example:**
```typescript
// Source: Codebase pattern from packages/modules/auth/src/commands/create-tenant.ts
import { Type } from "@sinclair/typebox";
import { defineCommand, ok, err } from "@baseworks/shared";
import { auth } from "../auth";

const CreateInvitationInput = Type.Object({
  email: Type.String({ format: "email" }),
  role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
  organizationId: Type.String(),
  sendEmail: Type.Boolean({ default: true }),
});

export const createInvitation = defineCommand(
  CreateInvitationInput,
  async (input, ctx) => {
    try {
      const invitation = await auth.api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: input.organizationId,
        },
        headers: new Headers(),
      });
      ctx.emit("invitation.created", {
        invitationId: invitation.id,
        organizationId: input.organizationId,
        email: input.email,
      });
      return ok(invitation);
    } catch (error: any) {
      return err(error.message || "Failed to create invitation");
    }
  },
);
```

### Pattern 2: Dashboard Page with Tabs (Settings Page)
**What:** Follow the billing page pattern -- `"use client"`, Suspense wrapper, Tabs with nuqs, useQuery/useMutation, useTranslations
**When to use:** The settings page
**Example structure:**
```typescript
// Source: Codebase pattern from apps/web/app/(dashboard)/dashboard/billing/page.tsx
"use client";
import { Suspense } from "react";
import { useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@baseworks/ui";

function SettingsContent() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "team" });
  const t = useTranslations("invite");
  return (
    <Tabs value={tab ?? "team"} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="team">{t("tabs.team")}</TabsTrigger>
      </TabsList>
      <TabsContent value="team">
        <MembersList />
        <PendingInvitations />
      </TabsContent>
    </Tabs>
  );
}
```

### Pattern 3: Public Page for Invite Acceptance
**What:** A page outside the dashboard layout (in `(auth)` route group) that fetches invitation details without requiring auth, then handles 3 user states
**When to use:** `/invite/[token]` page
**Key flow:**
1. Fetch invitation details via `auth.api.getInvitation({ query: { id: token } })` -- this is a public read
2. If user is logged in (check session): show Accept/Decline buttons
3. If user is not logged in: show Login/Create Account buttons with token preserved via query param `?invite=[token]`
4. After acceptance: call `auth.organization.setActive({ organizationId })` then redirect to `/dashboard`

### Pattern 4: sendInvitationEmail Callback
**What:** Add `sendInvitationEmail` to the organization plugin config, matching the existing `sendResetPassword` pattern
**When to use:** In `packages/modules/auth/src/auth.ts`
**Example:**
```typescript
// Source: better-auth docs + codebase pattern from sendResetPassword
organization({
  allowUserToCreateOrganization: true,
  creatorRole: "owner",
  organizationLimit: 5,
  sendInvitationEmail: async (data) => {
    const queue = getEmailQueue();
    const inviteLink = `${env.WEB_URL}/invite/${data.id}`;
    if (queue) {
      await queue.add("team-invite", {
        to: data.email,
        template: "team-invite",
        data: {
          inviteLink,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name,
          inviterEmail: data.inviter.user.email,
          role: data.role,
        },
      });
    } else {
      console.log(`[AUTH] Team invite for ${data.email}: ${inviteLink}`);
    }
  },
})
```
[CITED: https://better-auth.com/docs/plugins/organization]

### Anti-Patterns to Avoid
- **Building custom invitation tables:** The `invitation` table already exists and is managed by better-auth. Never create a separate invites table.
- **Using `ctx.db` (scoped DB) for invitation queries:** Auth/org tables are accessed via `auth.api.*`, not via the tenant-scoped database wrapper. This is established in Pitfall 6 from prior phases.
- **Hardcoding strings:** All UI text must use `useTranslations()` from next-intl (Phase 8 established this).
- **Sending email directly in the callback:** Use the BullMQ email queue -- matches existing pattern and ensures resilience.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Invitation CRUD | Custom invitation table/logic | `auth.api.createInvitation/acceptInvitation/rejectInvitation/cancelInvitation` | better-auth handles status management, role assignment, member creation on accept [CITED: https://better-auth.com/docs/plugins/organization] |
| Invitation token generation | Custom token/UUID generation | better-auth generates invitation IDs automatically | Avoids security issues with custom token schemes |
| Member creation on accept | Custom INSERT into member table | `auth.api.acceptInvitation()` auto-creates member record | better-auth handles the full flow including role assignment |
| Email delivery | Direct Resend call in callback | BullMQ `email:send` queue | Matches existing pattern, provides retry/resilience [VERIFIED: codebase] |
| Role permission checks | Custom role checking for invite actions | `requireRole("owner", "admin")` middleware | Already exists in codebase [VERIFIED: `packages/modules/auth/src/middleware.ts`] |

**Key insight:** better-auth's organization plugin already implements the complete invitation lifecycle. The only custom code needed is: (1) the email callback, (2) the email template, (3) the frontend UI, and (4) thin CQRS wrappers for module consistency.

## Common Pitfalls

### Pitfall 1: Invite Token Preservation Through Auth Redirects
**What goes wrong:** User clicks invite link, gets redirected to login, and the invite token is lost after login.
**Why it happens:** Login redirect doesn't carry the invite context forward.
**How to avoid:** Use a query parameter `?invite=[token]` on login/signup URLs. After successful login, check for the `invite` query param and redirect to `/invite/[token]` to complete acceptance. Query params survive redirects better than cookies or localStorage.
**Warning signs:** User logs in but doesn't end up in the invited org.

### Pitfall 2: Shareable Link vs Email Invite Confusion
**What goes wrong:** The `sendInvitationEmail` callback fires for shareable links too, sending unwanted emails.
**Why it happens:** `auth.api.createInvitation()` always triggers the callback if configured.
**How to avoid:** Two approaches: (a) Use a flag in the request to conditionally skip email in the callback, or (b) for shareable links, create the invitation without the email callback by not providing an email (if supported) or by using a wrapper that handles the distinction. Recommended: create a CQRS command that calls `auth.api.createInvitation()` and conditionally queues the email job separately, rather than relying on the `sendInvitationEmail` callback for all cases.
**Warning signs:** Users getting emails when admin just wanted a shareable link.

### Pitfall 3: Setting Active Organization After Acceptance
**What goes wrong:** User accepts invite but stays in their previous org context, not seeing the new org.
**Why it happens:** `acceptInvitation()` adds the user as a member but doesn't automatically set the org as active. [CITED: https://github.com/better-auth/better-auth/issues/3452]
**How to avoid:** After `acceptInvitation()` succeeds, explicitly call `auth.organization.setActive({ organizationId })` on the client side, then invalidate all React Query caches.
**Warning signs:** User sees "accepted successfully" but dashboard shows old org data.

### Pitfall 4: Invitation Expiration Conflict with D-11
**What goes wrong:** better-auth's `invitationExpiresIn` defaults to 48 hours, causing invitations to expire even though D-11 says "no auto-expiration."
**Why it happens:** Default configuration.
**How to avoid:** Set `invitationExpiresIn` to a very large value (e.g., 10 years in seconds: `315360000`) in the organization plugin config to effectively disable expiration. [CITED: https://better-auth.com/docs/plugins/organization]
**Warning signs:** Shareable links stop working after 48 hours.

### Pitfall 5: Public vs Authenticated Invitation Page
**What goes wrong:** The `/invite/[token]` page requires auth, blocking unauthenticated users from seeing invitation details.
**Why it happens:** If the page is inside the `(dashboard)` route group, the TenantProvider and auth checks block access.
**How to avoid:** Place the invite page in the `(auth)` route group (e.g., `apps/web/app/(auth)/invite/[token]/page.tsx`). Use `auth.api.getInvitation()` server-side or a public API endpoint to fetch invitation details without requiring authentication. The accept/reject actions DO require auth.
**Warning signs:** Unauthenticated users see a login page instead of the invitation details.

### Pitfall 6: Resend Invitation Semantics
**What goes wrong:** "Resend" creates a duplicate invitation instead of resending the existing one.
**Why it happens:** Calling `createInvitation` again for the same email creates a new record.
**How to avoid:** Use the `resend: true` flag in `auth.api.createInvitation()` or configure `cancelPendingInvitationsOnReInvite: true` in the organization plugin. [CITED: https://better-auth.com/docs/plugins/organization]
**Warning signs:** Multiple pending invitations for the same email in the management list.

## Code Examples

### Email Template (team-invite.tsx)
```typescript
// Source: Codebase pattern from packages/modules/billing/src/templates/password-reset.tsx
import { Html, Head, Body, Container, Text, Button, Hr } from "@react-email/components";

interface TeamInviteEmailProps {
  inviteLink: string;
  organizationName: string;
  inviterName: string;
  role: string;
}

export function TeamInviteEmail({
  inviteLink,
  organizationName,
  inviterName,
  role,
}: TeamInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f4f4f5" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "20px", backgroundColor: "#ffffff" }}>
          <Text style={{ fontSize: "24px", fontWeight: "bold" }}>
            You're invited to {organizationName}
          </Text>
          <Text>
            {inviterName} has invited you to join {organizationName} as a {role}.
          </Text>
          <Button
            href={inviteLink}
            style={{ backgroundColor: "#18181b", color: "#ffffff", padding: "12px 20px", borderRadius: "6px", textDecoration: "none" }}
          >
            Accept Invitation
          </Button>
          <Hr />
          <Text style={{ color: "#71717a", fontSize: "14px" }}>
            If you were not expecting this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

### Client-Side Invitation Acceptance Flow
```typescript
// Source: better-auth docs + codebase tenant-provider pattern
import { auth } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

async function handleAccept(invitationId: string, organizationId: string) {
  await auth.organization.acceptInvitation({ invitationId });
  await auth.organization.setActive({ organizationId });
  // Invalidate all queries for new org context
  queryClient.invalidateQueries();
  router.push("/dashboard");
}
```

### Module Registration Update
```typescript
// Source: Codebase pattern from packages/modules/auth/src/index.ts
// Add to commands map:
"auth:create-invitation": createInvitation,
"auth:accept-invitation": acceptInvitation,
"auth:reject-invitation": rejectInvitation,
"auth:cancel-invitation": cancelInvitation,

// Add to queries map:
"auth:list-invitations": listInvitations,
"auth:get-invitation": getInvitation,

// Add to events array:
"invitation.created",
"invitation.accepted",
"invitation.rejected",
"invitation.cancelled",
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom invitation tables | better-auth organization plugin built-in invitations | better-auth 1.x | No custom schema needed; invitation table already exists |
| JWT invitation tokens | better-auth uses DB-stored invitation IDs | N/A | Simpler, more secure -- tokens are opaque IDs looked up in DB |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `auth.api.getInvitation()` can be called without auth headers (public read) | Architecture Pattern 3 | If it requires auth, the public invite page needs a separate unauthenticated API endpoint to fetch invite details |
| A2 | `sendInvitationEmail` callback can be conditionally skipped for shareable links | Pitfall 2 | May need to not configure the callback globally and instead handle all email sending in a separate CQRS command |
| A3 | Setting `invitationExpiresIn` to a very large number effectively disables expiration | Pitfall 4 | May need to check if better-auth accepts very large values or if there is a "no expiration" option |
| A4 | `resend: true` flag on `createInvitation` re-sends to the same email without creating a duplicate | Pitfall 6 | If not supported, resend would need cancel-then-recreate pattern |

## Open Questions

1. **Public invitation fetch without auth**
   - What we know: `auth.api.getInvitation()` exists and returns invitation details
   - What's unclear: Whether it requires authenticated headers or can be called publicly
   - Recommendation: Test during implementation; if it requires auth, create a thin Elysia GET endpoint that calls `auth.api.getInvitation()` server-side without auth headers and returns sanitized data (org name, inviter name, role -- no sensitive fields)

2. **Shareable link email suppression**
   - What we know: `sendInvitationEmail` is called by better-auth when `createInvitation` is used
   - What's unclear: Whether there is a way to conditionally suppress the email for shareable links
   - Recommendation: Consider not configuring `sendInvitationEmail` in the plugin and instead sending emails explicitly in the CQRS command when `sendEmail: true`. This gives full control over when emails are sent.

3. **better-auth invitation ID format**
   - What we know: The invitation table has a text `id` primary key
   - What's unclear: Whether the ID is URL-safe (important for `/invite/[token]` routes)
   - Recommendation: If IDs contain special characters, URL-encode them. Most likely they are UUIDs or nanoids which are URL-safe.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun test (backend) / Vitest (frontend) |
| Config file | `packages/modules/auth/src/__tests__/` (existing test dir) |
| Quick run command | `bun test packages/modules/auth/src/__tests__/` |
| Full suite command | `bun test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INVT-01 | Create invitation with email + role | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - Wave 0 |
| INVT-02 | Email sent via queue on invitation | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - Wave 0 |
| INVT-03 | Shareable link generation (no email) | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - Wave 0 |
| INVT-04 | Accept invite joins org | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - Wave 0 |
| INVT-05 | List/cancel/resend invitations | unit | `bun test packages/modules/auth/src/__tests__/invitation.test.ts -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `bun test packages/modules/auth/src/__tests__/ -x`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/modules/auth/src/__tests__/invitation.test.ts` -- covers INVT-01 through INVT-05
- [ ] Test setup for mocking `auth.api.*` invitation methods (extend existing `auth-setup.test.ts` pattern)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | better-auth session for invite actions; public read for invite details only |
| V3 Session Management | yes | better-auth database sessions (already configured) |
| V4 Access Control | yes | `requireRole("owner", "admin")` for invite creation/cancellation; members cannot invite |
| V5 Input Validation | yes | TypeBox schemas on CQRS commands; Zod on frontend forms |
| V6 Cryptography | no | No custom crypto -- better-auth handles token generation |

### Known Threat Patterns for Invitations

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized invite creation | Elevation of Privilege | `requireRole("owner", "admin")` middleware on invite endpoints |
| Invite enumeration | Information Disclosure | Invitation details only shown to the invited email's owner or org admins |
| Invite link phishing | Spoofing | Branded landing page shows org name prominently; "if you were not expecting this" disclaimer |
| Self-invitation privilege escalation | Elevation of Privilege | better-auth should prevent inviting existing members; verify during implementation |
| Mass invitation spam | Denial of Service | `invitationLimit` config on better-auth (default 100) rate-limits invitations per org |

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/modules/auth/src/auth.ts` -- better-auth config with organization plugin
- Codebase inspection: `packages/db/src/schema/auth.ts` -- invitation table schema
- Codebase inspection: `packages/modules/auth/src/commands/create-tenant.ts` -- CQRS command pattern
- Codebase inspection: `packages/modules/billing/src/jobs/send-email.ts` -- email queue pattern
- Codebase inspection: `packages/modules/billing/src/templates/password-reset.tsx` -- email template pattern
- Codebase inspection: `apps/web/app/(dashboard)/dashboard/billing/page.tsx` -- dashboard page pattern
- Codebase inspection: `packages/api-client/src/auth-client.ts` -- organizationClient already wired

### Secondary (MEDIUM confidence)
- [better-auth organization plugin docs](https://better-auth.com/docs/plugins/organization) -- invitation API, sendInvitationEmail callback, configuration options
- [GitHub issue #3452](https://github.com/better-auth/better-auth/issues/3452) -- setActive after acceptInvitation workaround

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified in codebase
- Architecture: HIGH -- patterns directly derived from existing codebase (tenant commands, billing page, email templates)
- Pitfalls: MEDIUM -- some pitfalls based on better-auth docs and known issues, but A1-A4 need validation during implementation

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable -- all based on existing codebase patterns)
