---
phase: 11-a11y-gap-closure
verified: 2026-04-14T22:47:00Z
status: human_needed
score: 3/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Trigger invite dialog validation — submit with empty email, then with an invalid email (e.g. 'notanemail'), then with a valid email — check that NVDA/VoiceOver announces the error message each time"
    expected: "Screen reader announces the error text ('Email is required' / 'Invalid email') immediately on submit, via the role=alert rendered by FormMessage"
    why_human: "role=alert rendering is confirmed at the primitive level by vitest-axe (packages/ui form.a11y.test.tsx passes 3/3 a11y tests), but actual screen reader announcement of a dynamically mounted FormMessage within a Dialog requires a live assistive technology to confirm timing and routing through the dialog's ARIA subtree"
  - test: "Navigate auth pages (login, signup, forgot-password, reset-password, invite accept) with NVDA or VoiceOver heading navigation (H key in NVDA browse mode). Confirm each page announces a single h1 with no preceding h2/h3"
    expected: "Each auth page has exactly one h1 at the top level, no heading levels are skipped, and no CardTitle div masquerades as a heading"
    why_human: "Automated vitest-axe checks on auth pages cannot run without an apps/web vitest harness — bootstrapping one was explicitly out of scope for Phase 11 per CONTEXT.md. Static grep confirms zero CardTitle usages and zero h2/h3 elements, satisfying the structural requirement; the manual screen reader test is the only remaining verification gap for SC-4's 'automated vitest-axe' clause"
---

# Phase 11: Accessibility Gap Closure Verification Report

**Phase Goal:** Close the accessibility regressions v1.1 milestone audit found so A11Y-01, A11Y-04, and A11Y-05 are satisfied end-to-end across auth pages and the team invite dialog
**Verified:** 2026-04-14T22:47:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every auth page (login, signup, forgot password, reset password) renders an `<h1>` at the top of its Card — `CardTitle` no longer resolves to a generic `div` inside these pages | VERIFIED | `grep -rn "CardTitle" apps/web/app/(auth)/` returns 0 results. All 6 auth paths (login, signup, forgot-password, reset-password, magic-link, invite) use `<h1 className="text-2xl font-semibold leading-none tracking-tight">`. Invite accept page: 5 h1 elements across 5 card states, 0 CardTitle usages. |
| 2 | `apps/web/components/invite-dialog.tsx` uses shared Form/FormField/FormItem/FormMessage primitives — raw `<p className="text-sm text-destructive">` error paragraphs are removed | VERIFIED | `grep -c "text-sm text-destructive" apps/web/components/invite-dialog.tsx` = 0. FormMessage=4, FormField=3, FormControl=5, FormItem=5, FormLabel=3. Both email and role fields wrapped in FormField/FormItem/FormControl/FormMessage. |
| 3 | Submitting the invite dialog with an empty or invalid email announces the error to screen readers via `role="alert"` (verified through vitest-axe + manual screen reader check) | PARTIAL | vitest-axe portion: `packages/ui` vitest suite 20/20 pass including 3 form.a11y tests that confirm `FormMessage` renders `role="alert"` with correct text. InviteDialog now routes through FormMessage so the primitive guarantee transfers transitively. Manual screen reader verification still required. |
| 4 | Heading hierarchy on auth pages passes automated vitest-axe checks for heading order (no skipped levels) | PARTIAL | Structural verification passes: 0 h2/h3 elements under any auth page h1, 0 CardTitle divs, canonical class consistent across all pages. However, `apps/web` has no vitest harness (bootstrapping was explicitly out of scope per CONTEXT.md), so the "automated vitest-axe checks" clause of this success criterion cannot be confirmed by running a test suite — only by static code inspection. |

**Score:** 2 fully verified + 2 partially verified (structural requirements met, human/test runner confirmation pending) = **3/4 must-haves verified** (both partials pass their automated-verifiable dimension; the remaining gaps are the manual screen reader step for SC-3 and the missing vitest-axe test file for SC-4)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/app/(auth)/invite/[token]/page.tsx` | 5 h1 elements, 0 CardTitle | VERIFIED | Lines 151, 170, 188, 219, 292 — all `<h1 className="text-2xl font-semibold leading-none tracking-tight">`. CardTitle not imported, not referenced. |
| `apps/web/components/invite-dialog.tsx` | Form primitives, FormMessage, no raw error p | VERIFIED | FormMessage=4, FormField=3, FormControl=5, FormItem=5, FormLabel=3. `form.register`=0, `errors.email.type`=0, `text-sm text-destructive`=0. buildEmailSchema=3, useMemo=2. |
| `packages/ui/src/components/__tests__/form.a11y.test.tsx` | vitest-axe suite passes (upstream guarantee) | VERIFIED | 3/3 form.a11y tests pass, 20/20 total packages/ui tests pass. role=alert, aria-describedby, and axe clean confirmed at primitive level. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `invite-dialog.tsx` email field | `FormMessage` (packages/ui form.tsx) | FormField + FormItem + FormControl + FormMessage chain | WIRED | `<FormField control={form.control} name="email" render={({ field }) => (<FormItem><FormLabel>...<FormControl><Input ...{...field}/></FormControl><FormMessage/></FormItem>)}/>` — confirmed at lines 194-210 |
| `invite-dialog.tsx` role field | `FormMessage` (packages/ui form.tsx) | FormField + FormItem + FormControl + FormMessage chain | WIRED | `<FormField control={form.control} name="role" render={...}>` at lines 213-236 — SelectTrigger wrapped in FormControl |
| `zod emailSchema` | i18n validation messages | `buildEmailSchema(t)` factory + useMemo | WIRED | `buildEmailSchema` uses `.min(1, { message: t("dialog.validation.emailRequired") }).email({ message: t("dialog.validation.emailInvalid") })`. All 7 translation keys present (each grep returns 1). |
| `invite-dialog.tsx` | canonical login h1 pattern | className match | VERIFIED | Not applicable to invite-dialog. |
| `invite/[token]/page.tsx` h1 elements | canonical login h1 className | identical className string | WIRED | All 5 h1 elements use `text-2xl font-semibold leading-none tracking-tight`. Login page uses same class at line 85. |

### Data-Flow Trace (Level 4)

Not applicable — this phase modifies presentational/semantic HTML and form wiring, not data-fetching pipelines. No dynamic data sources changed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| invite page h1 count | `grep -c "<h1" apps/web/app/(auth)/invite/[token]/page.tsx` | 5 | PASS |
| invite page CardTitle count | `grep -c "CardTitle" apps/web/app/(auth)/invite/[token]/page.tsx` | 0 | PASS |
| invite page canonical class count | `grep -c "text-2xl font-semibold leading-none tracking-tight" apps/web/app/(auth)/invite/[token]/page.tsx` | 5 | PASS |
| auth pages CardTitle scan | `grep -rn "CardTitle" apps/web/app/(auth)/` | 0 results | PASS |
| invite-dialog raw error p | `grep -c "text-sm text-destructive" apps/web/components/invite-dialog.tsx` | 0 | PASS |
| invite-dialog FormMessage | `grep -c "FormMessage" apps/web/components/invite-dialog.tsx` | 4 | PASS |
| invite-dialog FormField | `grep -c "FormField" apps/web/components/invite-dialog.tsx` | 3 | PASS |
| invite-dialog form.register | `grep -c "form.register" apps/web/components/invite-dialog.tsx` | 0 | PASS |
| invite-dialog errors.email.type | `grep -c "errors.email.type" apps/web/components/invite-dialog.tsx` | 0 | PASS |
| 7 i18n keys preserved | `grep -c <key> invite-dialog.tsx` for each | 1 each | PASS |
| packages/ui vitest suite | `bunx vitest run` from packages/ui | 20/20 pass | PASS |
| form.a11y role=alert test | included in packages/ui run above | 3/3 pass | PASS |
| auth pages h2/h3 skip levels | `grep -rn "<h2\|<h3" apps/web/app/(auth)/` | 0 results | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| A11Y-01 | 11-01-PLAN.md | User navigates pages with proper semantic HTML landmarks (nav, main, aside, headings) | SATISFIED | All auth pages including invite accept page use `<h1>` at card top. CardTitle (div) eliminated from all auth pages. Canonical class consistent with Phase 07 pattern. |
| A11Y-04 | 11-02-PLAN.md | Screen reader user hears meaningful announcements for toasts, loading states, and dynamic content via aria-live regions | SATISFIED (structural) — human confirmation pending | InviteDialog routes email/role errors through FormMessage which renders `role="alert"`. vitest-axe confirms at primitive level. Manual screen reader test outstanding. |
| A11Y-05 | 11-02-PLAN.md | Screen reader user can understand all forms with proper labels, descriptions, and error announcements | SATISFIED (structural) — human confirmation pending | FormControl wires `aria-describedby` + `aria-invalid` automatically. FormLabel wires `htmlFor` via `formItemId`. All fields use Form primitive chain. vitest-axe confirms at primitive level. |

No orphaned requirements: REQUIREMENTS.md maps A11Y-01, A11Y-04, and A11Y-05 to Phase 11. All three are claimed by plans 11-01 and 11-02 respectively.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/components/invite-dialog.tsx` | 77 | `as unknown as Resolver<EmailFormValues>` cast | Info | Necessary workaround for TypeScript's inability to unify conditional schema union types with FormField's `Control<T>` constraint. Runtime is correct (email field unmounted in link mode). Documented inline in the file. Not a stub. |

No TODO/FIXME/placeholder comments found in modified files. No empty implementations. No stub return patterns.

### Human Verification Required

#### 1. InviteDialog role=alert screen reader announcement

**Test:** Open the invite dialog (click "Invite Member" button). Submit with empty email. Then submit with "notanemail". Use NVDA (browse mode off / forms mode) or VoiceOver.
**Expected:** Screen reader announces the validation error immediately after submit — "Email is required" for empty, "Invalid email" for malformed. Error clears when valid email entered.
**Why human:** The `FormMessage` `role="alert"` is confirmed at the primitive level by vitest-axe (packages/ui 3/3 form.a11y tests pass). However, the invite dialog mounts FormMessage inside a `Dialog` (which has its own ARIA tree), and the timing of when a dynamically-mounted `role="alert"` element is announced by live assistive technology within a dialog subtree requires manual confirmation.

#### 2. Auth page heading hierarchy — screen reader navigation

**Test:** On each auth page (login, signup, forgot-password, reset-password, invite accept), use NVDA heading navigation (H key) or VoiceOver heading rotor. Confirm: (a) exactly one h1 is announced per page state, (b) no heading levels are skipped, (c) no "heading level 1" is announced for what was previously a CardTitle div.
**Expected:** Each page announces one h1 with the page title. No h2/h3 follows the h1. No non-heading elements are announced as headings.
**Why human:** apps/web has no vitest harness, so automated vitest-axe checks for heading order (SC-4) cannot run programmatically. Static grep confirms 0 CardTitle usages and 0 h2/h3 elements across all auth pages, which is structurally correct. The ROADMAP SC-4 requires "automated vitest-axe checks" — that test infrastructure was explicitly deferred from Phase 11 scope per CONTEXT.md. Manual screen reader navigation is the available substitute until apps/web gets a vitest harness.

### Gaps Summary

No hard gaps blocking goal achievement. Both items requiring human verification are structural-pass / test-runner pending:

- **SC-3 (manual screen reader):** The `role="alert"` wiring is confirmed at the primitive level by vitest-axe. Manual AT test is the final closure step.
- **SC-4 (automated vitest-axe on auth pages):** apps/web has no vitest harness. The structural requirement (no h1 skips, no CardTitle divs) is fully met by static verification. Bootstrapping the test harness was explicitly out of scope per CONTEXT.md. This remains an outstanding test-coverage item.

Both deviations were intentional decisions documented in the phase CONTEXT.md. If the developer is satisfied that the structural requirements (confirmed by grep) plus the primitive-level vitest-axe coverage are sufficient for SC-3 and SC-4, those items can be accepted via an override.

---

_Verified: 2026-04-14T22:47:00Z_
_Verifier: Claude (gsd-verifier)_
