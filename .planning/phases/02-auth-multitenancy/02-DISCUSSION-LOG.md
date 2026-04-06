# Phase 2: Auth & Multitenancy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 02-auth-multitenancy
**Areas discussed:** better-auth integration, tenant-user relationship, RBAC implementation, auth module structure
**Mode:** --auto (all decisions auto-selected from recommended defaults)

---

## better-auth Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Mount at /api/auth/* | better-auth handler adapter for Elysia, auth owns routes | ✓ |
| Proxy through CQRS | Route all auth through command handlers | |

**User's choice:** [auto] Mount as Elysia route group at /api/auth/* (recommended -- per CLAUDE.md)

| Option | Description | Selected |
|--------|-------------|----------|
| Database sessions + cookies | Stored in PostgreSQL, httpOnly cookies, revocable | ✓ |
| JWT (stateless) | No server state, harder to revoke | |

**User's choice:** [auto] Database-backed sessions with cookies (recommended -- per CLAUDE.md constraint)

| Option | Description | Selected |
|--------|-------------|----------|
| Google + GitHub | Matches AUTH-02 spec | ✓ |
| Google only | Simpler setup | |
| Google + GitHub + more | Over-delivers on spec | |

**User's choice:** [auto] Google + GitHub (required by AUTH-02)

---

## Tenant-User Relationship

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-create on signup | Personal tenant created, user is owner | ✓ |
| Separate tenant creation | User creates tenant manually after signup | |
| Invite-only | Tenants pre-exist, users join via invite | |

**User's choice:** [auto] Auto-create personal tenant on signup (recommended -- simplest UX)

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-tenant membership | User belongs to multiple tenants, one active per session | ✓ |
| Single tenant per user | Simpler but limiting | |

**User's choice:** [auto] Multi-tenant membership (recommended -- flexible, standard pattern)

---

## RBAC Implementation

| Option | Description | Selected |
|--------|-------------|----------|
| Simple roles (owner/admin/member) | Matches TNNT-04, middleware enforcement | ✓ |
| Granular permissions | Fine-grained permission system | |
| Attribute-based (ABAC) | Complex, overkill for v1 | |

**User's choice:** [auto] Simple roles per TNNT-04 (recommended -- matches spec exactly)

| Option | Description | Selected |
|--------|-------------|----------|
| Elysia middleware guard | Composable requireRole() derive | ✓ |
| Handler-level checks | Each handler checks role manually | |
| Separate authorization service | Over-engineered for v1 | |

**User's choice:** [auto] Elysia middleware guard (recommended -- framework-native)

---

## Auth Module Structure

| Option | Description | Selected |
|--------|-------------|----------|
| Module in registry | packages/modules/auth/, loaded like any module | ✓ |
| Core concern | Wired directly in apps/api, not a module | |

**User's choice:** [auto] Module in registry (recommended -- proves module system)

| Option | Description | Selected |
|--------|-------------|----------|
| Session-derived tenant | Update middleware to read from session | ✓ |
| Keep header + add session | Support both during transition | |

**User's choice:** [auto] Session-derived tenant (recommended -- clean replacement)

---

## Claude's Discretion

- better-auth configuration details (plugin options, callback URLs)
- Auth schema generation approach
- Session expiration policy
- Tenant creation flow details (event-driven vs inline)
- Auth error response codes
- Whether auth + tenant is one module or two

## Deferred Ideas

- Team invites (v2)
- 2FA / passkeys
- Additional OAuth providers
- Avatar file upload
- Plan gating
