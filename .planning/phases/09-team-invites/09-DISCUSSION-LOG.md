# Phase 9: Team Invites - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-10
**Phase:** 09-team-invites
**Areas discussed:** Invite management UI, Accept/decline flow, Invite link behavior, Role & permissions

---

## Invite Management UI

### Location

| Option | Description | Selected |
|--------|-------------|----------|
| Settings > Team tab | New /dashboard/settings page with Team tab. Sidebar already has Settings link. | ✓ |
| Dedicated /dashboard/team page | Separate top-level page with new sidebar entry. | |
| Inside tenant switcher dropdown | Manage team option in existing dropdown. | |

**User's choice:** Settings > Team tab
**Notes:** Sidebar already references /dashboard/settings. Settings page structured for future tabs.

### Invite Presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Single invite form with toggle | One Invite button, dialog with email + role + toggle for email vs link. | ✓ |
| Separate sections | Two distinct sections on the page. | |
| You decide | Claude picks. | |

**User's choice:** Single invite form with toggle

---

## Accept/Decline Flow

### Landing Page

| Option | Description | Selected |
|--------|-------------|----------|
| Branded landing page | Shows org name, inviter, role, Accept/Decline buttons. | ✓ |
| Auto-accept with toast | Link auto-accepts, toast notification, redirect. | |
| You decide | Claude picks. | |

**User's choice:** Branded landing page

### New User Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Signup first, then auto-accept | Invite page shows create account prompt, email pre-filled, auto-accept on signup. | ✓ |
| Signup with invite code | Manual invite code field on signup page. | |
| You decide | Claude picks. | |

**User's choice:** Signup first, then auto-accept

---

## Invite Link Behavior

### Link Usage

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-use with optional limit | Link reusable until revoked or limit hit. | |
| Single-use only | Each link works once, admin generates new per person. | ✓ |
| You decide | Claude picks. | |

**User's choice:** Single-use only

### Expiration

| Option | Description | Selected |
|--------|-------------|----------|
| No auto-expiration | Links active until manually revoked. INVT-06 deferred to v1.2. | ✓ |
| 7-day default expiration | Auto-expire after 7 days. | |
| You decide | Claude picks. | |

**User's choice:** No auto-expiration

---

## Role & Permissions

### Available Roles

| Option | Description | Selected |
|--------|-------------|----------|
| Owner / Admin / Member | Three-tier with transferable ownership. | |
| Admin / Member only | Two roles, owner is org creator. | ✓ |
| You decide | Claude picks based on better-auth defaults. | |

**User's choice:** Admin / Member only (Owner is org creator, not assignable)

### Invite Permissions

| Option | Description | Selected |
|--------|-------------|----------|
| Admins invite any role except owner | Admins can invite admins and members. | ✓ |
| Admins invite members only | Only owners promote to admin. | |
| You decide | Claude picks. | |

**User's choice:** Admins can invite admins and members

---

## Claude's Discretion

- Invite dialog layout and form validation UX
- Invite token preservation through login/signup redirect
- Email template design (follow password-reset pattern)
- Member avatar display
- Admin dashboard integration
- Translation key structure

## Deferred Ideas

- INVT-06: Configurable invite expiration (v1.2)
- Multi-use invite links with limits (v1.2 enhancement)
- Admin dashboard invite management in tenant detail
