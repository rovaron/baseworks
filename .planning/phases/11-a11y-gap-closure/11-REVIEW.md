---
phase: 11-a11y-gap-closure
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - apps/web/app/(auth)/invite/[token]/page.tsx
  - apps/web/components/invite-dialog.tsx
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the two files touched by phase 11 (a11y gap closure). Both refactors deliver on the stated goals: the invite accept page now uses semantic `<h1>` elements in place of `CardTitle` (closing A11Y-01), and `invite-dialog.tsx` is correctly rewired onto `Form`/`FormField`/`FormMessage` with an i18n-aware `emailSchema` factory (closing A11Y-04 / A11Y-05). Form errors will now be announced via the shared `FormMessage` (which wires `aria-describedby` and `aria-invalid` under the hood) and validation strings localize correctly through the `useMemo`d factory.

No critical security, injection, or crash issues were found. The findings below are correctness and quality concerns introduced or surfaced by the refactor:

- One concrete missing-i18n-key bug (`tc("done")`) that will render the literal string `done` in production for both locales.
- Two semantic / a11y regressions on the accept page: multiple top-level `<h1>` elements in the same document and an unlabelled icon — both are A11Y-01-adjacent and worth fixing while the page is open.
- Several smaller maintainability issues (resolver cast hides a real type hole, `as any` on i18n keys, broad `queryClient.invalidateQueries()`, `error: any` swallowing).

## Warnings

### WR-01: Missing i18n key `common.done` renders literal "done" in UI

**File:** `apps/web/components/invite-dialog.tsx:165`
**Issue:** The "link generated" success state renders `{tc("done")}` as the close button label, but `packages/i18n/src/locales/en/common.json` and `pt-BR/common.json` do not define a `done` key. With next-intl's default error handler this will either throw a `MISSING_MESSAGE` error (dev) or fall back to rendering the raw key `"done"` to end users (prod) — visible regression in the happy-path link-generation flow that the phase 11-02 tests should have caught.
**Fix:** Either add the key to both locale files, or reuse an existing one (`common.close` already exists):
```tsx
// Option A: reuse existing key
<Button variant="outline" onClick={handleClose}>
  {tc("close")}
</Button>

// Option B: add the key to packages/i18n/src/locales/en/common.json
//   "done": "Done",
// and to pt-BR/common.json
//   "done": "Concluído",
```

### WR-02: Multiple `<h1>` elements on the invite accept page

**File:** `apps/web/app/(auth)/invite/[token]/page.tsx:151,170,188,219,292`
**Issue:** Phase 11-01 replaced 5 `CardTitle` usages with `<h1>` elements. Although only one of these branches renders at any given time at runtime, three of them (`219`, `292`) render the **org name** as the page heading rather than the actual purpose of the page. Two issues:

1. **No descriptive page heading.** Screen-reader users landing on this route hear `"Acme Corp"` as the document heading with no indication that this is an invitation acceptance flow. WCAG 2.4.6 (Headings and Labels) expects headings to describe the topic/purpose.
2. **`<h1>` overload risk.** If the `Card` component or any shared layout already emits an `<h1>` (e.g. a header/logo wordmark), the page will have multiple top-level headings, which is an A11Y-01 regression in the opposite direction. WebAIM and W3C both recommend exactly one `<h1>` per document.

**Fix:** Use a single `<h1>` whose text is the action/purpose, and demote org-name rendering to an `<h2>` or visually-emphasized non-heading text:
```tsx
<h1 className="mt-4 text-2xl font-semibold leading-none tracking-tight">
  {t("accept.heading")} {/* e.g. "Join an organization" */}
</h1>
<p className="mt-2 text-lg font-medium">{orgName}</p>
```
Add the `accept.heading` string to `invite.json` for both locales.

### WR-03: `AlertCircle` icon has no accessible name and the heading lacks association

**File:** `apps/web/app/(auth)/invite/[token]/page.tsx:150`
**Issue:** The error state renders `<AlertCircle className="h-12 w-12 text-destructive" />` with no `aria-label`, `aria-hidden`, or accompanying `<title>`. lucide-react icons render as SVGs that screen readers may announce as `"image"` with no context, or skip entirely. Decorative icons should be hidden from assistive tech; meaningful icons need a label. Since the heading immediately below already carries the error meaning, the icon is decorative.
**Fix:**
```tsx
<AlertCircle aria-hidden="true" className="h-12 w-12 text-destructive" />
```
Apply the same treatment to the other lucide icons used purely for decoration in this file (`Loader2` at lines 238, 273) and to the decorative `Plus` in `invite-dialog.tsx:142`.

## Info

### IN-01: Resolver cast hides a real type hole between linkSchema and EmailFormValues

**File:** `apps/web/components/invite-dialog.tsx:74-82`
**Issue:** The conditional resolver cast `as unknown as Resolver<EmailFormValues>` is documented in a comment, but the underlying problem is that `useForm<EmailFormValues>` is told the form always has an `email` field even when `isLinkMode === true` and the field is unmounted. RHF will still keep `email: ""` in `defaultValues`, which means `form.getValues().email` returns `""` in link mode. That happens to be harmless today (`onSubmit` ignores `values.email` in link mode), but a future contributor who reads the form values directly will get a misleading value.
**Fix:** Either (a) split into two `useForm` instances keyed by `isLinkMode`, or (b) make `email` optional in the type and use a discriminated union schema:
```ts
const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("email"), email: z.string().min(1).email(), role: z.enum(["admin","member"]) }),
  z.object({ mode: z.literal("link"), role: z.enum(["admin","member"]) }),
]);
```
This removes the `as unknown as Resolver<...>` cast entirely.

### IN-02: `t(\`roles.${invitation.role}\` as any)` casts away i18n key safety

**File:** `apps/web/app/(auth)/invite/[token]/page.tsx:230,303`
**Issue:** The `as any` cast bypasses next-intl's typed message keys. If the backend ever returns a role like `"owner"` (which exists in the i18n map) or an unknown role, there is no compile-time check. Also, two call sites duplicate the same expression.
**Fix:** Narrow the role to the known union and extract a helper:
```ts
type KnownRole = "owner" | "admin" | "member";
const roleLabel = t(`roles.${invitation.role as KnownRole}`);
```
Or validate `invitation.role` against the known set and fall back to a default.

### IN-03: `error: any` swallows useful diagnostics in handleAccept

**File:** `apps/web/app/(auth)/invite/[token]/page.tsx:99-108`
**Issue:** The accept flow detects the "already a member" branch by string-matching `error.message`. Two problems:
1. Substring matching on user-facing error text is brittle — any localization, capitalization, or backend rewording silently breaks the `alreadyMember` branch.
2. Other errors (network, 5xx) are completely swallowed: no toast, no log, the user just sees the spinner stop and nothing happens.

**Fix:** Prefer an error code from the API (e.g. `error.code === "ALREADY_MEMBER"`) and surface other failures via the same `toast.error(tc("error"))` pattern used in `invite-dialog.tsx`:
```ts
} catch (error) {
  const code = (error as { code?: string })?.code;
  if (code === "ALREADY_MEMBER") {
    setAlreadyMember(true);
  } else {
    toast.error(tc("error"));
  }
  setIsAccepting(false);
}
```

### IN-04: `queryClient.invalidateQueries()` with no key invalidates the entire cache

**File:** `apps/web/app/(auth)/invite/[token]/page.tsx:97`
**Issue:** Calling `invalidateQueries()` with no arguments invalidates **every** query in the cache. Since the very next line navigates to `/dashboard`, this triggers a refetch storm of every cached query the user has visited this session.
**Fix:** Invalidate only the keys that actually changed (session, organization list, current org):
```ts
await queryClient.invalidateQueries({ queryKey: ["session"] });
await queryClient.invalidateQueries({ queryKey: ["organizations"] });
```

### IN-05: `data: any` and `(data as any)?.data?.id` in inviteMutation.onSuccess

**File:** `apps/web/components/invite-dialog.tsx:95,103`
**Issue:** The mutation success handler types `data` as `any` and then double-unwraps `data.data.id`, which suggests the Eden Treaty response shape isn't being inferred. This defeats the project's stated reason for choosing Elysia (end-to-end type safety) and leaves a runtime hole — if the backend response shape changes, no type error catches it.
**Fix:** Let `useMutation` infer the return type from `mutationFn`, and type the API response so `data.id` (or whatever the actual shape is) is reachable directly without `as any`.

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
