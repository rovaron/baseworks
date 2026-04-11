---
phase: 09-team-invites
reviewed: 2026-04-11T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - apps/web/app/(auth)/invite/[token]/page.tsx
  - apps/web/app/(auth)/login/page.tsx
  - apps/web/app/(auth)/signup/page.tsx
  - apps/web/app/(dashboard)/dashboard/settings/page.tsx
  - apps/web/components/copy-link-button.tsx
  - apps/web/components/invite-dialog.tsx
  - apps/web/components/members-list.tsx
  - apps/web/components/pending-invitations.tsx
  - packages/i18n/src/index.ts
  - packages/i18n/src/locales/en/invite.json
  - packages/i18n/src/locales/pt-BR/invite.json
  - packages/modules/auth/src/__tests__/invitation.test.ts
  - packages/modules/auth/src/auth.ts
  - packages/modules/auth/src/commands/accept-invitation.ts
  - packages/modules/auth/src/commands/cancel-invitation.ts
  - packages/modules/auth/src/commands/create-invitation.ts
  - packages/modules/auth/src/commands/reject-invitation.ts
  - packages/modules/auth/src/index.ts
  - packages/modules/auth/src/queries/get-invitation.ts
  - packages/modules/auth/src/queries/list-invitations.ts
  - packages/modules/auth/src/routes.ts
  - packages/modules/billing/src/jobs/send-email.ts
  - packages/modules/billing/src/templates/team-invite.tsx
  - packages/ui/src/components/switch.tsx
  - packages/ui/src/index.ts
findings:
  critical: 2
  warning: 5
  info: 4
  total: 11
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-04-11T00:00:00Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

This phase implements the team invitation flow: create (email + shareable link modes), accept, reject, cancel, resend, and the supporting UI (invite dialog, members list, pending invitations table, branded accept page). The architecture is sound overall — the `@internal` email sentinel pattern is clean, CQRS command/query structure is consistent, and the i18n coverage is complete across both locales.

Two critical issues were found. The most serious is an open-redirect vulnerability on the invite accept page where the `inviteToken` query parameter is reflected unsanitized into `router.push()` calls on both the login and signup pages. The second is that the "resend" endpoint creates a brand-new invitation record without cancelling the original, leaving orphaned pending records in the database and in the UI. Five warnings cover: a clipboard API failure being swallowed silently, the `as any` cast on the API call that bypasses route-body type checking, the link-invite URL being constructed from the invitation `id` field rather than the validated `invitationId`, an `inviteToken` URL parameter accepted without format validation in signup, and the `acceptInvitation` command forwarding an empty `new Headers()` object rather than the caller's session headers. Four informational items cover: dead code in `signup/page.tsx`, a `console.error` left in production code path, a `JSX.Element` return type that should be `React.ReactElement`, and a missing `aria-label` on the copy button's icon-only fallback state.

---

## Critical Issues

### CR-01: Open-redirect via unsanitized `inviteToken` query parameter

**File:** `apps/web/app/(auth)/login/page.tsx:65` and `apps/web/app/(auth)/signup/page.tsx:70-87`

**Issue:** `inviteToken` is read directly from `useSearchParams()` without any validation and then spliced into `router.push()` as a path segment. An attacker can craft a URL such as `/login?invite=../../evil` or `/signup?invite=../../../external-site` and redirect the victim to an arbitrary path after a successful sign-in. On the signup page the token is also passed to `auth.organization.acceptInvitation({ invitationId: inviteToken })`, meaning a crafted value can attempt to call the backend with attacker-controlled input.

**Fix:** Validate that `inviteToken` matches the expected format (UUID or nanoid — both are alphanumeric with hyphens/underscores and bounded length) before using it. Reject silently if the format does not match.

```typescript
// shared utility, e.g. lib/invite.ts
const INVITE_TOKEN_RE = /^[a-zA-Z0-9_-]{10,40}$/;

function sanitizeInviteToken(raw: string | null): string | null {
  if (!raw || !INVITE_TOKEN_RE.test(raw)) return null;
  return raw;
}

// In login/page.tsx
const inviteToken = sanitizeInviteToken(searchParams.get("invite"));

// In signup/page.tsx
const inviteToken = sanitizeInviteToken(searchParams.get("invite"));
```

---

### CR-02: Resend creates a new invitation without cancelling the original, producing orphaned records

**File:** `packages/modules/auth/src/routes.ts:147-183`

**Issue:** The `POST /api/invitations/:id/resend` handler calls `createInvitation(...)` which creates a fresh invitation record. The original invitation (identified by `params.id`) is never cancelled. The result is that the pending invitations list will show both the old and the new record. An invitee who still has the original link can use it to join, defeating any intent to "resend a fresh link". For link-mode invites this also accumulates unbounded `@internal` placeholder rows.

**Fix:** Cancel the original invitation before creating the replacement.

```typescript
// In the resend handler, after fetching the existing invitation:
const cancelResult = await cancelInvitation(
  { invitationId: params.id, organizationId: activeOrgId },
  makeCtx("", activeOrgId),
);
if (!cancelResult.success) {
  set.status = 400;
  return { success: false, error: "Failed to cancel original invitation before resend" };
}
// Then proceed with createInvitation(...)
```

---

## Warnings

### WR-01: Clipboard write failure silently dropped in `CopyLinkButton`

**File:** `apps/web/components/copy-link-button.tsx:16-19`

**Issue:** `navigator.clipboard.writeText()` can throw (e.g., when the page is not focused, when the browser denies clipboard permission, or in HTTP contexts). The `await` is not wrapped in try/catch, so the error is swallowed. The button will show the "Copied!" state even though nothing was copied, and the React state update will run on an unmounted component if the user navigates away in the interim.

**Fix:**
```typescript
const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch {
    // Optionally show a toast error here
  }
};
```

---

### WR-02: `api.api.invitations.post(values as any)` bypasses body type validation

**File:** `apps/web/components/invite-dialog.tsx:65`

**Issue:** The Eden Treaty call casts `values` with `as any`, stripping the compile-time type check on the request body. The backend expects `{ email?, role, mode }` but the client sends the form values object which also includes `email: ""` (empty string) in link mode. The `as any` suppresses the TS error that would reveal this mismatch. In email mode when the email field is an empty string and mode is "email", the backend validation will accept the request (Elysia's `t.Optional(t.String({ format: "email" }))` only rejects if the field is present with a bad value, not if it is an empty string), though better-auth will reject it downstream.

**Fix:** Remove the `as any` cast and type the mutation argument explicitly:
```typescript
mutationFn: async (values: { email?: string; role: string; mode: "email" | "link" }) => {
  const payload = {
    role: values.role,
    mode: values.mode,
    ...(values.mode === "email" ? { email: values.email } : {}),
  };
  const { data, error } = await api.api.invitations.post(payload);
  if (error) throw error;
  return data;
},
```

---

### WR-03: Link-invite URL constructed from `data.id` but accept-page uses the token as `invitationId`

**File:** `apps/web/components/invite-dialog.tsx:77-78`

**Issue:** When the server returns a newly created invitation the URL is built as:
```typescript
const invitationId = data?.data?.id ?? data?.id;
const url = `${window.location.origin}/invite/${invitationId}`;
```
The double `data?.data?.id` path suggests uncertainty about the response shape. The accept page (`invite/[token]/page.tsx`) passes `params.token` directly to `auth.organization.acceptInvitation({ invitationId: token })` and to the `GET /api/invitations/:id` endpoint. If the actual response shape is `{ success: true, data: { id: "..." } }`, then `data?.data?.id` is correct. If the shape is `{ id: "..." }` (e.g. when the Eden Treaty client unwraps the envelope), then `data?.id` is correct. The fallback chain hides which one is actually used. A wrong ID silently produces an invalid URL that returns 404 on accept.

**Fix:** Pin to the actual response shape returned by the Eden Treaty client and assert it in tests. Remove the speculative fallback:
```typescript
// Prefer the Eden Treaty-unwrapped form; verify against actual response shape
const invitationId = (data as any)?.data?.id;
if (!invitationId) {
  toast.error(tc("error"));
  return;
}
const url = `${window.location.origin}/invite/${invitationId}`;
```

---

### WR-04: `acceptInvitation` and `rejectInvitation` commands pass `new Headers()` instead of caller's session

**File:** `packages/modules/auth/src/commands/accept-invitation.ts:23-26` and `packages/modules/auth/src/commands/reject-invitation.ts:21-25`

**Issue:** Both commands call `auth.api.acceptInvitation` / `auth.api.rejectInvitation` with `headers: new Headers()` — an empty header object. better-auth's `acceptInvitation` API typically requires a valid session to associate the accepting user with the new membership. Passing empty headers means the call has no session context. In practice these commands are currently called only from the client-side SDK (not via these CQRS commands), but if a route ever invokes them directly the result will be a silent auth failure or membership creation under no user.

**Fix:** Thread the caller's session token through `HandlerContext` and forward it:
```typescript
// In the command's context or pass headers as an argument
const result = await auth.api.acceptInvitation({
  body: { invitationId: input.invitationId },
  headers: ctx.headers ?? new Headers(),
});
```

---

### WR-05: `resendMutation` spinner shows for all rows when any row is loading

**File:** `apps/web/components/pending-invitations.tsx:162-166`

**Issue:** `resendMutation.isPending` is shared across all table rows. When any resend is in flight, every resend button in the table shows a spinner and is disabled. This is a logic error: only the button for the specific invitation being resent should show the loading indicator.

**Fix:** Track the pending resend ID in component state:
```typescript
const [resendingId, setResendingId] = useState<string | null>(null);

const resendMutation = useMutation({
  mutationFn: async (invitationId: string) => {
    setResendingId(invitationId);
    // ... existing mutationFn body
  },
  onSettled: () => setResendingId(null),
  // ... rest of options
});

// In the row:
disabled={resendingId === invitation.id}
// In the icon:
{resendingId === invitation.id
  ? <Loader2 className="h-4 w-4 animate-spin" />
  : <Mail className="h-4 w-4" />}
```

---

## Info

### IN-01: `console.error` left in production signup path

**File:** `apps/web/app/(auth)/signup/page.tsx:92`

**Issue:** `console.error("[SIGNUP] Auto-accept failed:", autoAcceptError)` will appear in production browser consoles, potentially leaking internal error details.

**Fix:** Replace with a structured logger or remove entirely. If user feedback is desired, display a non-blocking toast.

---

### IN-02: `inviteEmail` URL parameter accepted without format validation in signup

**File:** `apps/web/app/(auth)/signup/page.tsx:35` and `50`

**Issue:** `inviteEmail` is read from `searchParams.get("email")` and placed directly into the form's default value without checking that it looks like an email address. While the form's Zod schema will validate it before submission, an attacker-controlled value still pre-fills the email field with arbitrary text which could be confusing. This is a low-risk UX concern but worth sanitizing consistently alongside `inviteToken`.

**Fix:**
```typescript
const rawInviteEmail = searchParams.get("email");
const inviteEmail = rawInviteEmail && z.string().email().safeParse(rawInviteEmail).success
  ? rawInviteEmail
  : null;
```

---

### IN-03: `JSX.Element` return type in `send-email.ts` template map is outdated

**File:** `packages/modules/billing/src/jobs/send-email.ts:9`

**Issue:** `Record<string, (data: any) => JSX.Element>` uses the legacy `JSX.Element` global. In React 19 / TypeScript 5.x the preferred return type for React components is `React.ReactElement`. `JSX.Element` also requires the global JSX namespace to be in scope, which may cause type errors depending on the project's `tsconfig.json` `jsx` and `jsxImportSource` settings.

**Fix:**
```typescript
import type React from "react";
const templates: Record<string, (data: any) => React.ReactElement> = { ... };
```

---

### IN-04: `switch.tsx` imports `cn` via relative path `src/lib/utils` instead of package alias

**File:** `packages/ui/src/components/switch.tsx:4`

**Issue:** `import { cn } from "src/lib/utils"` uses a bare `src/` prefix rather than the package's own path alias (e.g. `@/lib/utils` or `../lib/utils`). This works only if the TypeScript `paths` config maps `src/*` explicitly. Other component files in the same package likely use `@/` or a relative path. The inconsistency could cause a module-not-found error in consumers that do not share the same path config.

**Fix:**
```typescript
import { cn } from "../lib/utils"
```

---

_Reviewed: 2026-04-11T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
