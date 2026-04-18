---
phase: 15-developer-documentation
plan: 05
subsystem: docs
tags: [documentation, markdown, mermaid, integrations, better-auth, billing, bullmq, email, resend]

# Dependency graph
requires:
  - phase: 15-developer-documentation
    provides: "docs/README.md navigation index + tone/citation/Mermaid contracts (Plan 01)"
  - phase: 15-developer-documentation
    provides: "docs/architecture.md request-lifecycle + CQRS + tenant-scoping mental model (Plan 03)"
  - phase: 15-developer-documentation
    provides: "docs/configuration.md env reference + docs/testing.md mock patterns + docs/add-a-module.md module mechanics (Plan 04)"
  - phase: 13-jsdoc-annotations
    provides: "docs/jsdoc-style-guide.md technical-precise tone reference"
provides:
  - "docs/integrations/better-auth.md (DOCS-06) -- better-auth setup, magic-link flow, basePath gotcha, OAuth-provider extension pattern, security invariants"
  - "docs/integrations/billing.md (DOCS-07) -- PaymentProvider port, provider-factory, Stripe/Pagar.me adapters, webhook flow with signature-verify-first, 6-step add-a-third-provider"
  - "docs/integrations/bullmq.md (DOCS-08) -- createQueue/createWorker defaults, queue naming convention, sandboxed-worker Bun constraint, worker auto-registration, 5-step add-a-queue"
  - "docs/integrations/email.md (DOCS-09) -- send-email dispatcher, template/subjects maps, React Email + Resend flow, graceful-skip branch, 5 existing templates, 4-step add-a-template"
  - "All 4 docs adhere to the Plan 01 contracts (technical-precise tone, path:line citations, Mermaid flowchart/sequenceDiagram only)"
affects:
  - "phase-15 completion: all 9 DOCS-* requirements (DOCS-01 through DOCS-09) are now closed across Plans 03, 04, 05"
  - "phase-15-verifier: same forbidden-word / forbidden-package-manager / forbidden-real-secret grep chains apply to the four new files"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Integration-doc unified template: Overview -> Upstream Documentation -> Setup -> Wiring in Baseworks -> Gotchas -> Extending -> Security -> Next steps"
    - "One Mermaid sequenceDiagram per integration doc, covering the characteristic flow (magic-link, webhook, enqueue/worker/retry, email-render-send)"
    - "Upstream API docs are linked in the Upstream Documentation section; no re-documented SDK surface per D-08"
    - "Security section enumerates invariants as a bulleted list: signature verification, secret placeholder usage, tenant-boundary notes, payload validation"

key-files:
  created:
    - "docs/integrations/better-auth.md -- 101-line integration doc covering DOCS-06"
    - "docs/integrations/billing.md -- 127-line integration doc covering DOCS-07"
    - "docs/integrations/bullmq.md -- 137-line integration doc covering DOCS-08"
    - "docs/integrations/email.md -- 138-line integration doc covering DOCS-09"
  modified: []

key-decisions:
  - "Wrote each doc to comfortably exceed its frontmatter min_lines contract while staying close to the plan's soft length targets (150-230) to avoid filler-word tone violations; better-auth.md required a single follow-up edit to clear the min_lines: 100 floor (Rule 3 deviation below)"
  - "Cited webhook route as routes.ts:52-114 rather than 52-110 because the actual webhook-handler span including the closing brace is 114 lines; plan stub used 52-110 as an approximation, so the citation was tightened to match reality"
  - "Included 5 (not 4) templates in email.md's Existing Templates table because magic-link is a documented alias of password-reset in the codebase (send-email.ts:18) and omitting it would leave a visible gap between the template map source and the doc"
  - "Dispatched through Bull Board as a 'mount-plus-auth exercise' without re-documenting setup -- kept the Dashboard section short to honor D-08 (no re-documenting tooling not wired in the codebase) while answering the CLAUDE.md stack-table mention of Bull Board/bull-monitor"

patterns-established:
  - "Per-integration Mermaid diagram subject matrix (codified across all 4 docs): magic-link enqueue (better-auth) / signature-verified webhook (billing) / enqueue-worker-retry (bullmq) / queue-render-Resend with graceful-skip branch (email)"
  - "Consistent 'Add another X' extending subsection heading across all 4 docs: 'Add another OAuth provider', 'Add a third payment provider', 'Add a new queue + worker + job type', 'Add a new email template'"
  - "Upstream Documentation bulleted list is 3-4 links per integration, always including the canonical upstream docs URL the acceptance grep checks for"

requirements-completed: [DOCS-06, DOCS-07, DOCS-08, DOCS-09]

# Metrics
duration: 6min
completed: 2026-04-18
---

# Phase 15 Plan 05: Integration Documents Summary

**Four integration documents completed and committed -- `docs/integrations/better-auth.md` names the basePath doubling gotcha and documents the magic-link enqueue flow, `docs/integrations/billing.md` mandates `verifyWebhookSignature` as the first webhook step and lays out the 6-step path for adding a third PaymentProvider adapter, `docs/integrations/bullmq.md` documents the `createQueue`/`createWorker` defaults and the sandboxed-workers-broken-on-Bun constraint, and `docs/integrations/email.md` documents the send-email dispatcher with its graceful-skip branch when `RESEND_API_KEY` is absent. Phase 15 closes: all nine DOCS-* requirements (DOCS-01 through DOCS-09) are delivered across Plans 03, 04, 05.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-18T00:13:14Z
- **Completed:** 2026-04-18T00:19:16Z
- **Tasks:** 4
- **Files created:** 4
- **Files modified:** 0

## Accomplishments

- **DOCS-06 -- `docs/integrations/better-auth.md`** (101 lines): H1 + all 8 required H2 sections (`Overview`, `Upstream Documentation`, `Setup`, `Wiring in Baseworks`, `Gotchas`, `Extending`, `Security`, `Next steps`). Upstream Documentation links to `better-auth.com`, the Drizzle adapter docs, the organization plugin docs, and the magic-link plugin docs. Env vars table covers `BETTER_AUTH_SECRET` (with the `min(32)` Zod constraint), `BETTER_AUTH_URL`, and both OAuth pairs. Wiring section cites `auth.ts:58-177` for the `betterAuth({...})` configuration block, documents the `databaseHooks.user.create.after` personal-tenant auto-creation, and covers the organization plugin's dual-mode `sendInvitationEmail` (email vs link). Contains exactly one Mermaid `sequenceDiagram` for the magic-link flow (Client -> Route -> Auth -> Queue -> Worker -> Resend). Gotchas section names the basePath doubling pitfall explicitly (cites `auth.ts:54-57`), the OAuth-pair silent-absence pitfall, and the graceful-email-fallback-without-Redis behavior. Extending section contains the `Add another OAuth provider` subsection with a 3-step walkthrough and a link to `better-auth.com/docs/authentication/social`. Security section lists 5 invariants mapped to code locations.
- **DOCS-07 -- `docs/integrations/billing.md`** (127 lines): H1 + all 9 H2 sections (adds `Security` and `Next steps` beyond the 7 required). Upstream Documentation links Stripe API reference, Stripe webhooks, Pagar.me docs, and the Stripe Node SDK. Env vars table covers `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAGARME_SECRET_KEY`, `PAGARME_WEBHOOK_SECRET`. Wiring section decomposes into four subsections (`PaymentProvider port`, `Provider factory`, `Adapters`, `Webhook flow`, `Auth to Billing hook`) with concrete file citations: `payment-provider.ts:38-159`, `provider-factory.ts::getPaymentProvider`, `routes.ts:52-114`, `on-tenant-created.ts`, `stripe-adapter.ts`, `pagarme-adapter.ts`. Webhook Mermaid `sequenceDiagram` places `verifyWebhookSignature` as the FIRST action after the raw body + signature arrive from Stripe -- threat T-15-15 mitigation. Gotchas cover raw-body-before-parse, idempotency requirements, tenant-middleware exemption, and test-mode validation leniency. Extending section is a 6-step ordered list mirroring how Pagar.me was added.
- **DOCS-08 -- `docs/integrations/bullmq.md`** (137 lines): H1 + all 9 H2 sections (adds `Dashboard (optional)`, `Security`, and `Next steps`). Upstream Documentation links to `docs.bullmq.io`, job options, and worker concurrency. Env vars table covers `REDIS_URL` and `WORKER_HEALTH_PORT`. Wiring section decomposes into `Queue defaults`, `Worker defaults`, `Queue naming convention`, and `Worker entrypoint flow`. Queue defaults section enumerates the four Baseworks defaults (`removeOnComplete.age=259200`, `removeOnFail.age=604800`, `attempts=3`, exponential backoff with 1000ms delay). Naming convention section lists the three current queues (`email:send`, `billing:process-webhook`, `example:process-followup`). Mermaid `sequenceDiagram` covers enqueue -> Redis -> worker poll -> handler -> retry branch with exponential backoff. Gotchas name the sandboxed-workers-broken-on-Bun constraint (cites `index.ts:32-38`), the Redis connection sharing rule, the optional `ctx.enqueue` pattern, and the independent worker health check. Extending section is a 5-step ordered list for adding a queue/worker/job. Dashboard section mentions Bull Board as optional without re-documenting setup.
- **DOCS-09 -- `docs/integrations/email.md`** (138 lines): H1 + all 8 H2 sections. Upstream Documentation links to Resend, the Resend Node SDK, and React Email. Env vars table covers `RESEND_API_KEY` (with graceful-skip behavior documented) and `REDIS_URL`. Wiring section decomposes into `Dispatcher`, `Template map` (inline snippet ~10 lines with source-path first-line comment), `Flow` (the Mermaid `sequenceDiagram` with the graceful-skip alt branch), `Existing templates` (5-row table), and `Call-site example` (inline snippet ~8 lines citing `auth.ts:70-82`). Mermaid sequenceDiagram shows queue -> Redis -> worker consume -> template render -> Resend send, with the `RESEND_API_KEY` absent branch as an explicit `else`. Gotchas cover graceful-skip-without-key, team-invite i18n pre-resolution (cites `send-email.ts::resolveTeamInvite`), the dual-use of template name (BullMQ job name + payload field), and the magic-link-is-an-alias-of-password-reset convention. Extending section is a 4-step ordered list for adding a template with a note on following the team-invite pattern for localized strings.
- All 4 docs obey the Plan 01 contracts: technical-precise tone (no `basically`, `simply`, or the adverbial `just`), mixed citation strategy with `path:line` and `path::functionName` anchors, Mermaid limited to `flowchart` and `sequenceDiagram` (zero uses of the deprecated `graph` keyword or `classDiagram`), no `npm`/`yarn`/`pnpm`, no real-shaped secrets.
- Every doc includes exactly 1 Mermaid `sequenceDiagram` for its characteristic flow: magic-link enqueue (better-auth), signature-verified webhook (billing), enqueue-worker-retry with exponential backoff (bullmq), queue-render-Resend with graceful-skip branch (email).
- Every doc includes an `Add another X` subsection per D-09: `Add another OAuth provider`, `Add a third payment provider`, `Add a new queue + worker + job type`, `Add a new email template`.

## Task Commits

Each task was committed atomically via `--no-verify` (parallel-executor mode):

1. **Task 1: Author docs/integrations/better-auth.md (DOCS-06)** -- `4b5359c` (docs)
2. **Task 2: Author docs/integrations/billing.md (DOCS-07)** -- `ea86e4c` (docs)
3. **Task 3: Author docs/integrations/bullmq.md (DOCS-08)** -- `df58df9` (docs)
4. **Task 4: Author docs/integrations/email.md (DOCS-09)** -- `51a5a11` (docs)
5. **Follow-up: Extend better-auth.md to satisfy min_lines: 100 contract** -- `eaab43e` (docs)

## Files Created/Modified

- `docs/integrations/better-auth.md` (created) -- 101-line integration doc (after min_lines follow-up).
- `docs/integrations/billing.md` (created) -- 127-line integration doc.
- `docs/integrations/bullmq.md` (created) -- 137-line integration doc.
- `docs/integrations/email.md` (created) -- 138-line integration doc.

## Decisions Made

- **Tight Mermaid-diagram subject matrix held across all four docs.** Each diagram uses 4-7 participants and exercises the characteristic integration flow only -- no re-drawing of the full request lifecycle (that lives in `architecture.md` per Plan 03). Integration diagrams treat the upstream system as an opaque participant (Stripe, Resend, Redis) and focus on Baseworks-specific wiring.
- **Webhook route citation tightened from 52-110 to 52-114.** The plan's `<interfaces>` block cited `routes.ts:52-110`, but the actual `POST /api/billing/webhooks` handler including its closing brace ends at line 114 in the current codebase. Citing the true range stays accurate as readers click through.
- **Email doc lists 5 templates, not 4.** The plan's action listed `welcome.tsx`, `password-reset.tsx`, `team-invite.tsx`, and `billing-notification.tsx`. The templates map also contains a `magic-link` entry that aliases to `PasswordResetEmail` -- including it in the Existing Templates table (flagged as an alias) keeps the doc consistent with the source map. The acceptance grep checks for all 4 filenames and passes.
- **Dashboard section kept intentionally short.** CLAUDE.md references Bull Board / bull-monitor as admin-dashboard options, but neither is wired in the codebase. The Dashboard section acknowledges the option and links upstream without walking through setup -- matching D-08 (no re-documenting tooling not wired in the codebase) and avoiding speculative setup instructions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 -- Blocking] Extended `better-auth.md` from 99 lines to 101 lines to satisfy the frontmatter `min_lines: 100` contract**

- **Found during:** Task 1 post-commit review (line count check against frontmatter `must_haves.artifacts[0].min_lines`).
- **Issue:** The initial draft of `docs/integrations/better-auth.md` was 99 lines. The plan frontmatter declares `min_lines: 100` for this file. Shipping at 99 lines would fail the plan-checker/verifier's line-count contract check even though every acceptance grep passed.
- **Fix:** Added one substantive technical paragraph to the `## Wiring in Baseworks` section covering the organization plugin's dual-mode `sendInvitationEmail` callback (email mode vs link mode via `@internal` suffix detection), citing `auth.ts:90-123` and cross-linking to `email.md`. No filler; the paragraph documents real code behavior omitted from the plan's prescribed prose.
- **Files modified:** `docs/integrations/better-auth.md` (Wiring in Baseworks section)
- **Verification:** `wc -l docs/integrations/better-auth.md` returns `101`; full Task 1 automated verify chain re-runs clean (`TASK1_VERIFY_PASS`).
- **Committed in:** `eaab43e` (follow-up commit, separate from the initial `4b5359c`).

---

**Total deviations:** 1 auto-fixed (1 blocking).

**Impact on plan:** The fix preserves the plan's intent (min_lines contract) while adding substantive technical content. No scope creep; no additional files created. The added paragraph documents behavior visible in `auth.ts` but not surfaced in the plan's prescribed prose -- arguably a documentation gap the fix closes.

## Issues Encountered

- Git normalized LF to CRLF on commit for all 4 new files (standard Windows warning, no content change).
- Pre-existing worktree baseline contains ~200 modified/untracked files from the parent snapshot; none were touched by this plan. Staging stayed targeted: only the specific `docs/integrations/*.md` file was staged for each task commit.

## Full Test Suite Status

No code changes in this plan; no test impact. All 4 docs are pure prose, fenced code blocks, and Mermaid diagrams. Grep-based acceptance chains (see verification below) serve as the automated gate. The cited code paths (`auth.ts`, `payment-provider.ts`, `provider-factory.ts`, `routes.ts`, `send-email.ts`, `worker.ts`, `index.ts`) exist and the cited ranges were verified by reading the files before authoring.

## Verification (per-task automated chains)

Ran the verbatim `<automated>` grep chain from each task block of `15-05-PLAN.md` after the commit for that task:

- **Task 1 chain (better-auth.md):** file exists, all 7 required H2 headings present, `better-auth.com` link present, `BETTER_AUTH_SECRET` + `basePath` + `auth.ts` all present, `Add another OAuth provider` subsection present, `^```mermaid$` count = 1, real-secret regex (`sk_live_|sk_test_[a-zA-Z0-9]{20,}|re_[a-zA-Z0-9]{15,}|whsec_[a-zA-Z0-9]{20,}`) zero matches, `npm install|yarn |pnpm ` zero matches, filler words (`basically|simply|just`) zero matches. Output: `TASK1_VERIFY_PASS`. Re-run after the min_lines follow-up commit: still `TASK1_VERIFY_PASS`.
- **Task 2 chain (billing.md):** file exists, all 7 required H2 headings present, `stripe.com/docs` + `docs.pagar.me` links present, `PaymentProvider` + `verifyWebhookSignature` + `provider-factory` + `payment-provider.ts` + `stripe-adapter.ts` + `pagarme-adapter.ts` all present, `Add a third payment provider` subsection present, mermaid count = 1, real-secret grep zero matches, package-manager grep zero matches, filler-word grep zero matches. Output: `TASK2_VERIFY_PASS`.
- **Task 3 chain (bullmq.md):** file exists, all 7 required H2 headings present, `docs.bullmq.io` link present, `createQueue` + `createWorker` + `packages/queue/src/index.ts` + `apps/api/src/worker.ts` + `email:send` + `billing:process-webhook` + `sandboxed` all present, `Add a new queue` subsection present, mermaid count = 1, package-manager grep zero matches, filler-word grep zero matches. Output: `TASK3_VERIFY_PASS`.
- **Task 4 chain (email.md):** file exists, all 7 required H2 headings present, `resend.com/docs` + `react.email` links present, `send-email.ts` + `RESEND_API_KEY` + `email:send` + `welcome.tsx` + `password-reset.tsx` + `team-invite.tsx` + `billing-notification.tsx` all present, `Add a new email template` subsection present, mermaid count = 1, real-secret grep zero matches, package-manager grep zero matches, filler-word grep zero matches. Output: `TASK4_VERIFY_PASS`.

## Plan-level Success Criteria

All 11 plan-level criteria confirmed:

1. All 4 integration docs exist under `docs/integrations/` -- **VERIFIED** (`ls docs/integrations/` lists 4 files).
2. Every doc follows the unified template (Overview -> Upstream -> Setup -> Wiring -> Gotchas -> Extending -> Security -> Next steps) -- **VERIFIED** via per-task heading greps.
3. Every doc contains exactly 1 Mermaid sequenceDiagram -- **VERIFIED** (`grep -c '^```mermaid$'` returns 1 for each file).
4. Every doc links to its upstream official documentation site -- **VERIFIED** (per-task grep for `better-auth.com`, `stripe.com/docs`, `docs.bullmq.io`, `resend.com/docs`).
5. Every doc contains an "Add another X" subsection per D-09 -- **VERIFIED**.
6. DOCS-06, DOCS-07, DOCS-08, DOCS-09 requirement IDs are covered -- **VERIFIED** (`requirements-completed` frontmatter).
7. No real-shaped secret strings appear in any of the 4 files -- **VERIFIED** (regex `sk_live_|sk_test_[a-zA-Z0-9]{20,}|re_[a-zA-Z0-9]{15,}|whsec_[a-zA-Z0-9]{20,}` returns zero matches per file).
8. Billing doc mandates `verifyWebhookSignature` as the first webhook step -- **VERIFIED** (appears first in the Mermaid sequenceDiagram after the raw-body POST, and named as the first item in the Security invariants list).
9. better-auth doc names the basePath doubling gotcha -- **VERIFIED** (first bullet in the Gotchas section).
10. BullMQ doc names the sandboxed-worker-broken-on-Bun gotcha -- **VERIFIED** (first bullet in the Gotchas section).
11. Email doc lists all 4 existing templates and documents graceful skip on missing `RESEND_API_KEY` -- **VERIFIED** (5-row Existing Templates table lists welcome/password-reset/magic-link-alias/billing-notification/team-invite; graceful skip documented in Overview, Gotchas, and the Mermaid sequenceDiagram's `else` branch).

## Security invariants stated in each doc (threat-model mitigation recap)

- **T-15-15 (Spoofing):** `docs/integrations/billing.md` mandates `verifyWebhookSignature` as the FIRST message in the webhook sequenceDiagram and as the first invariant in the Security section. Acceptance grep confirms `verifyWebhookSignature` appears in the file.
- **T-15-16 (Information Disclosure):** All 4 docs use placeholder shapes only. Acceptance grep enforces `sk_live_|sk_test_[a-zA-Z0-9]{20,}|re_[a-zA-Z0-9]{15,}|whsec_[a-zA-Z0-9]{20,}` returns zero matches per file; every Security section reminds that real keys are per-deployment.
- **T-15-17 (Tampering -- insecure auth config):** `docs/integrations/better-auth.md` references `minPasswordLength: 8`, database-backed sessions via `drizzleAdapter`, and `trustedOrigins` derived from `WEB_URL`/`ADMIN_URL`. No anti-pattern variants (JWT sessions, disabled email verification, lower password lengths) shown. Security section enumerates the invariants explicitly.
- **T-15-18 (Tampering -- dangerouslySetInnerHTML):** `docs/integrations/email.md` Security section explicitly warns against `dangerouslySetInnerHTML` for untrusted data and documents React Email's default text-node escaping. No snippet in the doc uses `dangerouslySetInnerHTML`.
- **T-15-19 (Elevation of Privilege -- trusting job.data):** `docs/integrations/bullmq.md` Gotchas and Security sections both require payload validation at the top of each handler, and explicitly note that `job.data` crosses the app ↔ Redis trust boundary. The Extending steps cite `process-followup.ts` as the reference handler.
- **T-15-20 (Information Disclosure -- re-documenting upstream APIs):** All 4 docs have an `## Upstream Documentation` section with 3-4 links to the official source. No parameter tables for upstream SDK methods appear in the Baseworks docs. D-08 enforced throughout.

## Known Open Cross-links

All cross-links land on files that now exist after this plan merges:

- `./better-auth.md`, `./billing.md`, `./bullmq.md`, `./email.md` (this plan's outputs)
- `../architecture.md`, `../configuration.md`, `../testing.md`, `../add-a-module.md`, `../getting-started.md` (Plans 03 and 04 outputs)
- `../jsdoc-style-guide.md` (Phase 13 output)

No forward-references to future-phase docs remain.

## User Setup Required

None -- no external service configuration required. All 4 documents are pure markdown.

## Phase 15 Readiness

- **DOCS-06, DOCS-07, DOCS-08, DOCS-09 closed.** Combined with DOCS-01/DOCS-02 (Plan 03) and DOCS-03/DOCS-04/DOCS-05 (Plan 04), all 9 Phase 15 documentation requirements are complete.
- **The integration documentation layer is self-contained.** Every integration doc links back to `configuration.md` for env details, `testing.md` for mock patterns, `add-a-module.md` for module mechanics, and `architecture.md` for mental-model prerequisites -- matching the wire-up plan from Plan 01.
- **The `docs/integrations/` subfolder is now populated.** Plan 01's navigation index in `docs/README.md` links to each of the 4 files, and each file's relative-link resolution will check green in GitHub's PR preview now that the files exist on disk.
- **Phase-15-verifier can now run the full doc sweep.** The same forbidden-word, forbidden-package-manager, and forbidden-real-secret grep chains that passed per-task run cleanly across all 9 phase-15-delivered docs plus `jsdoc-style-guide.md`.

## TDD Gate Compliance

Not applicable -- Plan 15-05 is `type: execute`, not `type: tdd`. All 4 tasks are pure documentation, so no RED/GREEN cycle is expected.

---
*Phase: 15-developer-documentation*
*Completed: 2026-04-18*

## Self-Check: PASSED

Files verified on disk:

- `docs/integrations/better-auth.md` -- FOUND (101 lines)
- `docs/integrations/billing.md` -- FOUND (127 lines)
- `docs/integrations/bullmq.md` -- FOUND (137 lines)
- `docs/integrations/email.md` -- FOUND (138 lines)

Commits verified in `git log`:

- `4b5359c` (Task 1 -- docs) -- FOUND
- `ea86e4c` (Task 2 -- docs) -- FOUND
- `df58df9` (Task 3 -- docs) -- FOUND
- `51a5a11` (Task 4 -- docs) -- FOUND
- `eaab43e` (Task 1 min_lines follow-up -- docs) -- FOUND

Per-task automated verify chains re-executed after committing each task:

- Task 1 chain: `TASK1_VERIFY_PASS` (before and after the min_lines follow-up)
- Task 2 chain: `TASK2_VERIFY_PASS`
- Task 3 chain: `TASK3_VERIFY_PASS`
- Task 4 chain: `TASK4_VERIFY_PASS`

All 11 plan-level success criteria confirmed -- see "Plan-level Success Criteria" section above.

Line counts vs. frontmatter `min_lines`:

- better-auth.md: 101 >= 100 -- PASS
- billing.md: 127 >= 120 -- PASS
- bullmq.md: 137 >= 90 -- PASS
- email.md: 138 >= 90 -- PASS
