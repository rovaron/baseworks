# Phase 11: Accessibility Gap Closure - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning
**Source:** v1.1 Milestone Audit (`.planning/v1.1-MILESTONE-AUDIT.md`) — treated as PRD

<domain>
## Phase Boundary

Close two specific accessibility regressions the v1.1 milestone audit flagged as `must fix before shipping`:

1. **A11Y-01 (partial)** — Heading hierarchy gap on the invite accept page. `CardTitle` renders as a `<div>` (packages/ui/src/components/card.tsx:36), and the invite accept page at `apps/web/app/(auth)/invite/[token]/page.tsx` uses `<CardTitle>` as the top-of-page heading in all 5 card states instead of `<h1>`. The audit's earlier gap closure (Phase 07-04) fixed the login/signup/forgot-password/reset-password/magic-link pages by hand (they already use `<h1 className="text-2xl font-semibold ...">`) but missed the Phase 9 invite accept page that was added later.
2. **A11Y-04 / A11Y-05 (partial, GAP-3)** — `apps/web/components/invite-dialog.tsx` renders email validation errors as raw `<p className="text-sm text-destructive">` (lines 180-186) instead of going through the shared `FormMessage` primitive. Screen readers do not announce the error because there is no `role="alert"` and no `aria-describedby` linking the error to the input. The file also uses raw `<Label>` + `<Input>` with direct `form.register("email")` bindings instead of `FormField`/`FormItem`/`FormControl`/`FormMessage`, so the same wiring is missing for every field on the form.

Out of scope: anything outside these two locations. Other audit gaps (GAP-1 email template i18n, GAP-2 skip-link label) are handled by Phase 12.

</domain>

<decisions>
## Implementation Decisions

### A11Y-01: Invite accept page heading hierarchy

**Locked (from audit + codebase inspection):**
- The page at `apps/web/app/(auth)/invite/[token]/page.tsx` has 5 card states, each with a `<CardTitle>` at the top: loading (line 152), not-found (line 171), declined (line 189), accept-form (line 218), auto-accept (line 289). Each of these is the first heading the user encounters on the page.
- Every auth page must have exactly one `<h1>` at the top of its primary card (per existing pattern established by Phase 07-04 on login/signup/etc).
- `CardTitle` is a third-party shadcn primitive that intentionally renders `<div>` — do NOT change the `CardTitle` definition itself (cascading change, out of phase scope).

**Claude's Discretion:**
- Whether to replace `<CardTitle>` with `<h1>` inline (matching login page pattern: `<h1 className="text-2xl font-semibold leading-none tracking-tight">...`) or introduce a local wrapper. Recommendation: inline `<h1>` to match the pattern already established by 07-04, and drop the `CardTitle` import.
- Whether all 5 card states get `<h1>` or only the "main" flow (loading + accept-form + auto-accept). Recommendation: all 5 — every card state is a top-level page state, so each needs an `<h1>` when rendered. No conditional heading structure.
- Visual styling should stay identical — `className="text-2xl font-semibold leading-none tracking-tight"` reuses the exact classes from login/signup.

### A11Y-04 / A11Y-05 / GAP-3: InviteDialog Form primitive refactor

**Locked (from audit + codebase inspection):**
- `FormMessage` already renders `role="alert"` (packages/ui/src/components/form.tsx:158)
- `FormControl` already wires `aria-describedby` to `formMessageId` and `aria-invalid` when `error` is set (packages/ui/src/components/form.tsx:114-119)
- `FormField` + `FormItem` + `FormControl` + `FormMessage` is the project-standard shape for react-hook-form + shadcn forms
- All Form primitives are exported from `@baseworks/ui` via `packages/ui/src/index.ts:form`
- The current InviteDialog uses `useForm` from `react-hook-form` with `zodResolver(emailSchema)` — the schema stays identical, only the JSX wiring changes
- Existing translation keys must be preserved: `t("dialog.emailLabel")`, `t("dialog.emailPlaceholder")`, `t("dialog.validation.emailRequired")`, `t("dialog.validation.emailInvalid")`, `t("dialog.roleLabel")`, `t("roles.member")`, `t("roles.admin")`

**Claude's Discretion:**
- Whether to migrate only the `email` field (minimum fix) or all fields including `role` (complete refactor). Recommendation: refactor both email and role fields to a single `<Form>` wrapper with `FormField` children — this produces consistent a11y wiring and matches "bypasses Form primitives" audit language which implicates the whole dialog, not just one field.
- The existing validation error mapping (`too_small` vs invalid email) must be preserved inside `FormMessage`. The planner should either inline the logic into the render prop passed to `FormField`, or move the mapping into a custom refine on the zod schema so `errors.email.message` carries the correct translated string directly. Recommendation: schema-level refine — puts the i18n logic at schema construction, keeps JSX clean, and `FormMessage` renders `errors.email.message` without conditional logic.
- Whether to replace the `Label` for the `role` Select with `FormLabel`. Recommendation: yes — consistent primitives throughout.

### Regression prevention

**Locked:**
- Phase 07-03 established vitest-axe tests for `packages/ui` primitives only. `apps/web` has no vitest-axe setup today (confirmed via codebase scan — no vitest-axe imports in apps/web).
- Phase 11 must include a regression test that would have caught both bugs.

**Claude's Discretion:**
- Where to locate the regression test. Options:
  1. Add a vitest-axe smoke test for `InviteDialog` in `apps/web/__tests__/` — requires setting up vitest-axe in apps/web (new pattern).
  2. Add a vitest-axe test alongside the existing packages/ui form.a11y.test.tsx that renders a minimal reproduction of the invite dialog's form structure.
  3. Add a DOM-assertion test (no axe) that checks for `role="alert"` on the error node and for `<h1>` presence on the invite accept page.
- Recommendation: Option 3 (DOM assertions) — cheapest, fastest, catches the exact regressions. Puts one test in `apps/web/components/__tests__/invite-dialog.test.tsx` (assert `role="alert"` appears after submitting with empty email) and one in `apps/web/app/(auth)/invite/__tests__/page.test.tsx` OR inside an existing test file if one exists. Defers "full vitest-axe in apps/web" as a separate future concern — out of audit scope.

### Verification

**Locked:**
- All changes must preserve the existing pt-BR translations (Phase 11 does not touch i18n — that is Phase 12).
- All changes must preserve current visual appearance (heading size, form layout, error styling).
- `bun test` and the web app typecheck must pass after the changes.
- The v1.1 audit re-run must flip A11Y-01, A11Y-04, A11Y-05 from partial to satisfied.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit & Requirements
- `.planning/v1.1-MILESTONE-AUDIT.md` — Authoritative gap list with file:line evidence (audit date 2026-04-13). GAP-3 section and A11Y-01 row are the primary sources of truth for Phase 11 scope.
- `.planning/REQUIREMENTS.md` — Requirement text for A11Y-01, A11Y-04, A11Y-05.
- `.planning/ROADMAP.md` — Phase 11 goal and success criteria.

### Files to modify
- `apps/web/app/(auth)/invite/[token]/page.tsx` — 5 `<CardTitle>` usages to replace with `<h1>` (lines 152, 171, 189, 218, 289).
- `apps/web/components/invite-dialog.tsx` — Full `Form` primitive refactor; email error paragraphs at lines 180-186 are the smoking gun but the whole form wiring is in scope.

### Reference implementations (read to match patterns, do not modify)
- `apps/web/app/(auth)/login/page.tsx:85` — Canonical `<h1>` pattern for auth Card pages (`className="text-2xl font-semibold leading-none tracking-tight"`). Signup, forgot-password, reset-password, and magic-link use the same pattern.
- `packages/ui/src/components/form.tsx` — Full Form primitive implementation. Study `FormControl`, `FormMessage`, `FormField`, `useFormField` to understand how `role="alert"` and `aria-describedby` flow through.
- `packages/ui/src/components/__tests__/form.a11y.test.tsx` — Example vitest-axe usage with Form primitives (reference only — Phase 11 is not expected to run axe in apps/web).

### Shared primitives used
- `@baseworks/ui` exports: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` (from `packages/ui/src/index.ts` → `./components/form`).

</canonical_refs>

<specifics>
## Specific Ideas

**Audit-derived acceptance criteria (every one must be grep-verifiable after the phase):**

1. `grep -c "CardTitle" apps/web/app/\(auth\)/invite/\[token\]/page.tsx` returns `0` (all usages replaced)
2. `grep -c '<h1' apps/web/app/\(auth\)/invite/\[token\]/page.tsx` returns `5` (one per card state) — or equivalent count if card states are consolidated
3. `grep -c "text-sm text-destructive" apps/web/components/invite-dialog.tsx` returns `0` (raw error paragraphs removed)
4. `grep -c "FormMessage" apps/web/components/invite-dialog.tsx` returns `>= 1`
5. `grep -c "FormField" apps/web/components/invite-dialog.tsx` returns `>= 2` (email field + role field)
6. Running `bun test` in the repo passes (existing tests must not regress)
7. Regression test file exists and asserts `role="alert"` on rendered InviteDialog form errors
8. Regression test file exists (or existing test extended) that asserts the invite accept page renders exactly one top-level `<h1>` per card state

**Visual / UX constraints (nothing visible should change):**
- Heading font size/weight/tracking stay identical (reuse `text-2xl font-semibold leading-none tracking-tight`)
- Error message position stays directly below the input
- Error message color stays `text-destructive` (FormMessage already uses `text-sm font-medium text-destructive`)
- Focus ring and tab order unchanged

</specifics>

<deferred>
## Deferred Ideas

**Not in Phase 11:**
- Changing `CardTitle` to accept an `as` prop or default to `<h2>` — cascading packages/ui refactor, out of scope. Audit does not request it.
- Running vitest-axe on the full invite accept page — requires new vitest-axe setup in apps/web, deferred as tech debt beyond this phase.
- Fixing Phase 9 "human_needed" UAT status — that is a manual verification concern, handled by `/gsd-verify-work 9` after this phase lands.
- i18n cleanup (GAP-1, GAP-2) — Phase 12 owns that scope.
- Phase 8 VERIFICATION.md regeneration — post-Phase 12 verifier rerun, not a plan task.
- Adding `<h1>` to routes other than the invite accept page — all other auth pages already have `<h1>` per grep verification.

</deferred>

---

*Phase: 11-a11y-gap-closure*
*Context gathered: 2026-04-13 via audit-as-PRD path*
