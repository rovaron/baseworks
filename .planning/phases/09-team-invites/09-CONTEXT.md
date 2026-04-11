# Phase 9: Team Invites - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Organization admins can invite users to their team with role assignment, and invited users can accept via email link or shareable URL. Covers invite-by-email, single-use invite links, accept/decline flow for existing and new users, and a management page for pending invitations.

</domain>

<decisions>
## Implementation Decisions

### Invite Management UI
- **D-01:** Invite management lives at `/dashboard/settings` with a "Team" tab — sidebar already has a Settings link pointing there
- **D-02:** Settings page structured for future tabs (Profile, Preferences) but ships with Team tab only
- **D-03:** Team tab shows current members list + pending invitations list
- **D-04:** Single "Invite" button opens a dialog with email field + role selector + toggle between "Send email invite" and "Generate shareable link"

### Accept/Decline Flow
- **D-05:** Branded landing page at `/invite/[token]` showing org name, inviter name, assigned role, and Accept/Decline buttons
- **D-06:** If user is logged in, Accept/Decline processes immediately
- **D-07:** If user is not logged in but has an account, redirect to login with invite token preserved, auto-process on return
- **D-08:** If user has no account, show "Create account to join" with email pre-filled from invite, auto-accept on signup completion
- **D-09:** After accepting, user lands in the org dashboard with the org auto-selected as active tenant

### Invite Link Behavior
- **D-10:** Shareable invite links are single-use — each link works once, admin generates a new link per person
- **D-11:** No auto-expiration — links stay active until manually revoked (INVT-06 deferred to v1.2)
- **D-12:** Admin can revoke (cancel) any pending invitation from the management page

### Roles & Permissions
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — INVT-01 through INVT-05 define acceptance criteria for team invites
- `.planning/REQUIREMENTS.md` — INVT-06 (configurable expiration) explicitly deferred to v1.2

### better-auth Organization Plugin
- `packages/modules/auth/src/auth.ts` — better-auth config with organization plugin already enabled (allowUserToCreateOrganization, creatorRole, organizationLimit)
- `packages/api-client/src/auth-client.ts` — Client-side organizationClient() plugin already wired

### Database Schema
- `packages/db/src/schema/auth.ts` — Existing organization, member, and invitation tables (owned by better-auth)

### Auth Module (CQRS pattern to follow)
- `packages/modules/auth/src/index.ts` — Module definition with commands/queries/events map
- `packages/modules/auth/src/commands/create-tenant.ts` — Canonical command pattern (defineCommand + ok/err)
- `packages/modules/auth/src/queries/list-members.ts` — Existing member listing query
- `packages/modules/auth/src/routes.ts` — Elysia route pattern for tenant-scoped endpoints

### Email Infrastructure
- `packages/modules/billing/src/jobs/send-email.ts` — Email job handler with template/subject maps
- `packages/modules/billing/src/templates/password-reset.tsx` — Reference template for invite email (has CTA button + explanatory text)

### Frontend Patterns
- `apps/web/components/sidebar-nav.tsx` — Sidebar with existing Settings link
- `apps/web/app/(dashboard)/dashboard/billing/page.tsx` — Reference page pattern (useQuery, useMutation, Dialog, toast, useTranslations)
- `apps/web/components/tenant-provider.tsx` — useTenant() hook for active org context

### i18n
- `packages/i18n/src/locales/en/common.json` — Shared translation keys
- `packages/i18n/src/locales/en/auth.json` — Auth-related translations (extend for invite strings)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **better-auth org plugin** — `auth.api.createInvitation()`, `auth.api.acceptInvitation()`, `auth.api.cancelInvitation()`, `auth.api.getInvitation()` all available server-side
- **better-auth client SDK** — `auth.organization.inviteMember()`, `auth.organization.acceptInvitation()`, `auth.organization.rejectInvitation()`, `auth.organization.cancelInvitation()` available client-side
- **invitation table** — Already exists in Drizzle schema with id, organizationId, email, role, status, expiresAt, inviterId
- **Email queue** — `email:send` BullMQ queue already processes email jobs; just add new template entry
- **React Email templates** — `password-reset.tsx` provides exact pattern for invite email (CTA button, explanatory text)
- **Sidebar Settings link** — Already references `/dashboard/settings` in nav, just needs the page created

### Established Patterns
- CQRS: `defineCommand(TypeBoxSchema, async (input, ctx) => ok(result) | err(message))`
- Auth tables accessed via `auth.api.*`, never via `ctx.db` (scoped DB is for tenant data only)
- Frontend pages: `"use client"`, `useQuery`/`useMutation` from React Query, `useTranslations()` for i18n, `toast` for feedback
- `sendInvitationEmail` callback available in better-auth org plugin config (same pattern as `sendResetPassword`)

### Integration Points
- `packages/modules/auth/src/auth.ts` — Add `sendInvitationEmail` callback to org plugin config
- `packages/modules/auth/src/index.ts` — Register new invite commands/queries/events
- `packages/modules/billing/src/jobs/send-email.ts` — Add `team-invite` template entry
- `apps/web/app/(dashboard)/dashboard/settings/page.tsx` — New page (route already expected by sidebar)
- `apps/web/app/(auth)/invite/[token]/page.tsx` — New public invite accept page
- `packages/i18n/src/locales/` — Add invite-related translation keys to en and pt-BR

</code_context>

<specifics>
## Specific Ideas

- Invite dialog should toggle between email invite and shareable link generation — single UI entry point
- Accept page should feel branded (show org name prominently) and handle the three user states (logged in, has account, new user) gracefully
- Email pre-filled on signup when coming from invite link

</specifics>

<deferred>
## Deferred Ideas

- **INVT-06: Configurable invite expiration** — Already tracked in REQUIREMENTS.md as v1.2
- **Multi-use invite links** — User chose single-use for v1.1; multi-use with limits could be a v1.2 enhancement
- **Admin dashboard invite management** — Whether to add invite viewing/management to the admin tenant detail page (Claude's discretion for now)

</deferred>

---

*Phase: 09-team-invites*
*Context gathered: 2026-04-10*
