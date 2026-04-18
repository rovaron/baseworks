---
phase: 15-developer-documentation
verified: 2026-04-18T00:36:00Z
status: gaps_found
score: 22/23 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A `scripts/validate-docs.ts` Bun script runs at phase close and (a) fails if any docs/**/*.md file contains the forbidden string `@baseworks/test-utils`, (b) fails on leaked secret shapes, and (c) counts Mermaid code fences across docs/ — failing if the count is below 8 (D-01 minimum)"
    status: failed
    reason: "The script does not exist on disk. No scripts/ directory exists at the repo root. Plan 15-05 listed validate-docs.ts in must_haves.artifacts and had Task 5 prescribing its creation, but the 15-05-SUMMARY only documents Tasks 1-4 and no task block for Task 5 was executed. No git history exists for scripts/validate-docs.ts. The invariants the script was meant to enforce are currently satisfied by the docs tree (verified manually during this verification: 8 Mermaid fences, zero @baseworks/test-utils occurrences, zero real-shaped secrets), but the automation gate is missing — regressions in a future doc edit would be caught only if a human remembers to re-run the greps manually."
    artifacts:
      - path: "scripts/validate-docs.ts"
        issue: "File does not exist; parent `scripts/` directory does not exist"
    missing:
      - "Create scripts/ directory"
      - "Create scripts/validate-docs.ts per Plan 15-05 Task 5 — implement the three validation layers (forbidden @baseworks/test-utils import, secret-shape regexes for sk_live_/sk_test_/re_/whsec_, Mermaid fence floor of 8 across docs/)"
      - "Run `bun run scripts/validate-docs.ts` and confirm it exits 0 against the current docs tree"
      - "Commit with a docs(15-05): commit following the existing naming convention"
---

# Phase 15: Developer Documentation Verification Report

**Phase Goal:** Deliver developer documentation (DOCS-01 through DOCS-09) — getting started, architecture, add-a-module tutorial, configuration reference, testing guide, and four integration docs (better-auth, billing, BullMQ, email) — all conforming to the locked Phase 15 contracts (tone, code-citation format, Mermaid syntax). Plus extending `packages/modules/example` to exercise all four module surfaces (D-05) so the tutorial can walk through a real four-surface module.

**Verified:** 2026-04-18T00:36:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

The must-haves were merged from (a) ROADMAP.md §"Phase 15 Success Criteria" and (b) `must_haves` frontmatter across the five Plan 15-0X files. Score counts one row per truth below.

#### Roadmap Success Criteria (authoritative contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A Getting Started guide walks through prerequisites, install, env setup, dev server, and running tests | VERIFIED | `docs/getting-started.md` (117 lines) contains all 11 required H2 sections (Prerequisites, Clone and install, Configure env vars, Start Postgres+Redis, Apply migrations, Run API, Run worker, Run tests, Run frontends, Next steps, Troubleshooting). All bun commands present: `bun install`, `bun docker:up`, `bun db:migrate`, `bun api`, `bun worker`, `bun test`. No npm/yarn/pnpm, no filler words, no real-shaped secrets. |
| 2 | An Architecture Overview with Mermaid diagrams explains module system, CQRS flow, request lifecycle, and tenant scoping | VERIFIED | `docs/architecture.md` (156 lines) contains exactly 4 Mermaid fences (module system flowchart, CQRS sequenceDiagram, request-lifecycle flowchart, tenant-scoping flowchart). Concrete code anchors verified by grep: `ModuleRegistry` (2), `CqrsBus` (5), `TypedEventBus` (3), `scopedDb` (6), `tenantMiddleware` (3), `HandlerContext` (6), `registry.ts` (4), `scoped-db.ts` (4). Zero uses of deprecated `graph` keyword or `classDiagram`. |
| 3 | An "Add a Module" step-by-step tutorial uses the example module as reference to create a new module from scratch | VERIFIED | `docs/add-a-module.md` (165 lines) has 10 `## Step N:` headings plus `What you will build`, `Smoke test`, `Security checklist`, `Next steps`. Cites the post-Plan-02 example module files: `create-example.ts`, `list-examples.ts`, `process-followup.ts`. Names all registration anchors (`moduleImportMap`, `ModuleDefinition`, `defineCommand`, `defineQuery`). Uses the relative `../../../__test-utils__/mock-context` path convention (zero occurrences of the forbidden `@baseworks/test-utils` workspace package name). Links to `./architecture.md` as prerequisite. |
| 4 | Configuration and testing guides cover env vars, module config, provider selection, test runner split, mock patterns, and how to test commands/queries | VERIFIED | `docs/configuration.md` (104 lines) documents all critical env vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `REDIS_URL`, `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`, `PAGARME_SECRET_KEY`, `RESEND_API_KEY`, `INSTANCE_ROLE`, `WORKER_HEALTH_PORT`), both startup guards (`validatePaymentProviderEnv`, `assertRedisUrl`), `moduleImportMap`, and `docker-compose.yml`. `docs/testing.md` (121 lines) documents all 8 required H2 sections plus `createMockContext` (7x), `createMockDb` (5x), `assertResultOk` (4x), `mock.module` (9x), `bun test` (3x), and `Vitest` as deferred. |
| 5 | Integration docs for better-auth, Stripe/Pagar.me billing, BullMQ queues, and Resend/React Email each explain setup, customization, and extension points | VERIFIED | All 4 files exist under `docs/integrations/` with the unified template (Overview → Upstream → Setup → Wiring → Gotchas → Extending → Security → Next steps). Each contains exactly 1 Mermaid sequenceDiagram. Each has an "Add another X" subsection (`Add another OAuth provider`, `Add a third payment provider`, `Add a new queue + worker + job type`, `Add a new email template`). Each links to its upstream canonical docs site. |

#### Plan 15-01 must-haves (docs/README.md navigation index + contracts)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | docs/README.md indexes the 9 Phase 15 deliverables by filename and purpose | VERIFIED | File exists (48 lines). H1 `# Baseworks Developer Documentation` present. 6 H2 sections. Contents table links to all 10 docs (9 deliverables + jsdoc-style-guide.md) with relative `./` prefix. |
| 7 | docs/README.md declares the tone contract by linking to docs/jsdoc-style-guide.md | VERIFIED | 2 occurrences of `jsdoc-style-guide` in README.md. Tone section references "General Rules" lines 12-23. |
| 8 | docs/README.md states the code-citation format (path:line for >10 lines, function-name anchors preferred, inline for ≤10 lines) | VERIFIED | `## Code Citations` section present with all three rules. |
| 9 | docs/README.md states the Mermaid syntax contract (flowchart / sequenceDiagram / stateDiagram-v2 only; never the deprecated `graph` keyword) | VERIFIED | `## Mermaid Diagrams` section present; all three permitted syntaxes named; `graph` keyword called out as forbidden. |
| 10 | docs/README.md declares the integrations/ subfolder convention for DOCS-06..09 | VERIFIED | Contents table lists `./integrations/better-auth.md`, `./integrations/billing.md`, `./integrations/bullmq.md`, `./integrations/email.md`. |

#### Plan 15-02 must-haves (D-05 example module extension)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 11 | When createExample runs, example.created emits, registerExampleHooks fires, and a BullMQ job is added to `example:process-followup` which the worker consumes | VERIFIED | `packages/modules/example/src/commands/create-example.ts` emits `example.created`; `packages/modules/example/src/hooks/on-example-created.ts` subscribes via `eventBus.on("example.created", ...)` and calls `queue.add("example:process-followup", { exampleId, tenantId })`; `packages/modules/example/src/index.ts` registers `example:process-followup` in the `jobs` map so `apps/api/src/worker.ts` auto-starts a worker. End-to-end wiring verified by code inspection. |
| 12 | A processFollowup job handler exists that accepts `{ exampleId, tenantId }` and returns without throwing on the happy path | VERIFIED | `packages/modules/example/src/jobs/process-followup.ts:17-27` (27 lines, >= min_lines 20). Signature `(data: unknown) => Promise<void>`. Test `process-followup.test.ts` asserts happy-path resolution. |
| 13 | registerExampleHooks is invoked at API startup in apps/api/src/index.ts | VERIFIED | `apps/api/src/index.ts:10` imports `registerExampleHooks`; `apps/api/src/index.ts:38` invokes `registerExampleHooks(registry.getEventBus())` next to `registerBillingHooks`. |
| 14 | The example module's jobs map registers `example:process-followup` | VERIFIED | `packages/modules/example/src/index.ts:14-19` — `jobs: { "example:process-followup": { queue: "example:process-followup", handler: processFollowup } }`. |
| 15 | Unit tests for createExample, processFollowup, and registerExampleHooks; `bun test packages/modules/example` passes with all tests green | VERIFIED | Behavioral spot-check: `bun test packages/modules/example` → 8 pass / 0 fail, 17 expect() calls, 3 test files. |

#### Plan 15-05 must-haves (integration docs + phase-close validator)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 16 | better-auth.md explains Baseworks-specific wiring and links out to better-auth.com | VERIFIED | 5 occurrences of `better-auth.com`. Basepath/magic-link/OAuth content present. |
| 17 | better-auth.md includes a Mermaid sequenceDiagram for the magic-link flow | VERIFIED | Exactly 1 `\`\`\`mermaid` block; `sequenceDiagram` syntax. |
| 18 | better-auth.md names the basePath doubling gotcha | VERIFIED | 3 occurrences of `basePath`. Gotchas section first bullet. |
| 19 | billing.md documents the PaymentProvider port, both adapters, provider-factory | VERIFIED | 14 occurrences of `PaymentProvider`; cites `payment-provider.ts`, `provider-factory`, `stripe-adapter.ts`, `pagarme-adapter.ts`. |
| 20 | billing.md includes a Mermaid sequenceDiagram for the webhook flow with verifyWebhookSignature as the FIRST step | VERIFIED | 1 mermaid block; 4 occurrences of `verifyWebhookSignature`. |
| 21 | billing.md includes an "Add a third payment provider" section mirroring Pagar.me | VERIFIED | Exact phrase present; 6-step ordered list. |
| 22 | bullmq.md documents createQueue/createWorker defaults, naming convention, inline-processor constraint | VERIFIED | `createQueue` (4), `createWorker` (5), `email:send` (2), `billing:process-webhook` (2), `sandboxed` (2). |
| 23 | bullmq.md includes a sequenceDiagram and an "Add a new queue + worker + job" section | VERIFIED | 1 mermaid block; `Add a new queue` subsection present. |
| 24 | email.md documents the send-email dispatcher, templates, Resend call, graceful skip | VERIFIED | `send-email.ts` (8), `RESEND_API_KEY` (9), template files all named. |
| 25 | email.md includes a sequenceDiagram and "Add a new email template" section | VERIFIED | 1 mermaid block; `Add a new email template` subsection present. |
| 26 | All 4 integration docs link to their official upstream docs | VERIFIED | `better-auth.com`, `stripe.com/docs`, `docs.pagar.me`, `docs.bullmq.io`, `resend.com/docs`, `react.email` all present in respective files. |
| 27 | A `scripts/validate-docs.ts` Bun script runs at phase close (forbidden-import, secret-shape, Mermaid-fence floor) | **FAILED** | **File does not exist. No `scripts/` directory in repo root. Git log shows no commit introducing this file. 15-05-SUMMARY documents only Tasks 1-4.** |

**Score:** 26/27 truths verified + 0 overrides = 26/27. The `must_haves_verified` count in frontmatter is normalized to `22/23` using the grouped roadmap SCs (5) + plan-specific truths (18) — one truth per distinct must-have claim. By either counting method, exactly one truth is failing.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---------|---------|--------|---------|
| `docs/README.md` | Navigation index with 3 contracts | VERIFIED | 48 lines; all 6 H2 sections present; 11 relative links; 2 jsdoc references. |
| `docs/getting-started.md` | DOCS-01, min 80 lines, contains `bun install` | VERIFIED | 117 lines (≥ 80); `bun install` present. |
| `docs/architecture.md` | DOCS-02, min 120 lines, contains `\`\`\`mermaid` | VERIFIED | 156 lines (≥ 120); 4 mermaid blocks. |
| `docs/add-a-module.md` | DOCS-03, min 150 lines, contains `packages/modules/example` | VERIFIED | 165 lines (≥ 150); example module cited throughout. |
| `docs/configuration.md` | DOCS-04, min 100 lines, contains `packages/config/src/env.ts` | VERIFIED | 104 lines (≥ 100); env.ts cited. |
| `docs/testing.md` | DOCS-05, min 80 lines, contains `createMockContext` | VERIFIED | 121 lines (≥ 80); createMockContext cited 7 times. |
| `docs/integrations/better-auth.md` | DOCS-06, min 100 lines, contains `better-auth.com` | VERIFIED | 101 lines (≥ 100); 5 upstream links. |
| `docs/integrations/billing.md` | DOCS-07, min 120 lines, contains `PaymentProvider` | VERIFIED | 127 lines (≥ 120); PaymentProvider cited 14 times. |
| `docs/integrations/bullmq.md` | DOCS-08, min 90 lines, contains `createQueue` | VERIFIED | 137 lines (≥ 90); createQueue cited 4 times. |
| `docs/integrations/email.md` | DOCS-09, min 90 lines, contains `Resend` | VERIFIED | 138 lines (≥ 90); Resend referenced throughout. |
| `packages/modules/example/src/jobs/process-followup.ts` | BullMQ handler, min 20 lines | VERIFIED | 27 lines; exports `processFollowup`. |
| `packages/modules/example/src/hooks/on-example-created.ts` | Event listener, min 25 lines, exports `registerExampleHooks` | VERIFIED | 76 lines; exports `registerExampleHooks`. |
| `packages/modules/example/src/index.ts` | Module def with jobs map + re-export | VERIFIED | 22 lines; `example:process-followup` registered; re-exports `registerExampleHooks`. |
| `apps/api/src/index.ts` | Invokes `registerExampleHooks` | VERIFIED | Import line 10; invocation line 38. |
| `packages/modules/example/src/__tests__/create-example.test.ts` | 3 unit tests | VERIFIED | Tests pass. |
| `packages/modules/example/src/__tests__/process-followup.test.ts` | 2 unit tests | VERIFIED | Tests pass. |
| `packages/modules/example/src/__tests__/on-example-created.test.ts` | 3 unit tests | VERIFIED | Tests pass. |
| `scripts/validate-docs.ts` | Phase-close validator, min 40 lines, contains `@baseworks/test-utils` | **MISSING** | **File and parent directory do not exist.** |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `docs/README.md` | `docs/jsdoc-style-guide.md` | relative markdown link in Tone section | WIRED | 2 occurrences of jsdoc-style-guide link. |
| `docs/README.md` | `docs/integrations/` | table row listing integration docs | WIRED | All 4 integration doc filenames linked. |
| `packages/modules/example/src/hooks/on-example-created.ts` | `packages/modules/example/src/jobs/process-followup.ts` | `queue.add("example:process-followup", payload)` | WIRED | Literal string present; job registered in module index. |
| `apps/api/src/index.ts` | `packages/modules/example/src/hooks/on-example-created.ts` | `registerExampleHooks(registry.getEventBus())` | WIRED | Import + invocation both present. |
| `packages/modules/example/src/index.ts` | `packages/modules/example/src/jobs/process-followup.ts` | jobs map registration | WIRED | Direct import + registration in jobs object. |
| `docs/getting-started.md` | `docs/architecture.md` | next-step link | WIRED | Link present in Next steps section. |
| `docs/architecture.md` | `packages/db/src/helpers/scoped-db.ts` | code citation | WIRED | 4 occurrences of `scoped-db.ts`. |
| `docs/architecture.md` | `apps/api/src/core/registry.ts` | code citation | WIRED | 4 occurrences of `registry.ts`. |
| `docs/add-a-module.md` | `docs/architecture.md` | prerequisite link | WIRED | 2 occurrences of `architecture.md`. |
| `docs/add-a-module.md` | `packages/modules/example/src/commands/create-example.ts` | code citation | WIRED | `create-example.ts` referenced. |
| `docs/add-a-module.md` | `packages/modules/example/src/jobs/process-followup.ts` | code citation in job-handler step | WIRED | `process-followup.ts` referenced. |
| `docs/configuration.md` | `packages/config/src/env.ts` | source-of-truth citation | WIRED | `env.ts` cited. |
| `docs/testing.md` | `packages/modules/__test-utils__/mock-context.ts` | mock factory citation | WIRED | `mock-context.ts` cited 3 times. |
| `docs/integrations/better-auth.md` | `https://www.better-auth.com` | Upstream Documentation section | WIRED | 5 occurrences. |
| `docs/integrations/billing.md` | `packages/modules/billing/src/ports/payment-provider.ts` | port reference | WIRED | `payment-provider.ts` cited. |
| `docs/integrations/billing.md` | `https://stripe.com/docs` | Upstream Documentation | WIRED | 2 occurrences. |
| `docs/integrations/bullmq.md` | `packages/queue/src/index.ts` | createQueue/createWorker citation | WIRED | Cited. |
| `docs/integrations/email.md` | `packages/modules/billing/src/jobs/send-email.ts` | dispatcher citation | WIRED | 8 occurrences. |

### Data-Flow Trace (Level 4)

For the D-05 example module code (Plan 15-02):

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `process-followup.ts` | `data` (job payload) | BullMQ job queue (Redis) | Yes — serialized `{ exampleId, tenantId }` from `queue.add` call in hook | FLOWING |
| `on-example-created.ts` | `{ id, tenantId }` (event payload) | `ctx.emit("example.created", ...)` in `create-example.ts` | Yes — emitted inside the command handler after DB insert | FLOWING |
| `example module jobs map` | `example:process-followup` entry | `packages/modules/example/src/index.ts` | Yes — direct import of `processFollowup` | FLOWING |

Documentation artifacts (DOCS-01..09) are static content; Level 4 data-flow does not apply (no dynamic data rendering).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Example module tests pass (D-05 four-surface module is wired end-to-end) | `bun test packages/modules/example` | `8 pass / 0 fail, 17 expect() calls, 287ms` | PASS |
| docs/ tree has no forbidden `@baseworks/test-utils` string | `grep -rn "@baseworks/test-utils" docs/` | Zero matches | PASS |
| docs/ tree has no real-shaped secrets | `grep -rnE "sk_live_\|sk_test_[a-zA-Z0-9]{20,}\|re_[a-zA-Z0-9]{15,}\|whsec_[a-zA-Z0-9]{20,}" docs/` | Zero matches | PASS |
| Mermaid fence count ≥ 8 across docs/ | `grep -r "^\`\`\`mermaid" docs/ \| wc -l` | 8 fences (4 architecture + 4 integration) | PASS |
| docs/ uses only permitted Mermaid syntaxes | `grep -rhE "^(flowchart\|sequenceDiagram\|graph \|classDiagram)" docs/` | `flowchart LR` x2, `flowchart TD` x1, `sequenceDiagram` x5 — zero `graph`/`classDiagram` | PASS |
| docs/ has no filler words (basically/simply/just) outside the pre-existing `jsdoc-style-guide.md` enumeration | `grep -rnE "\\b(basically\|simply\|just)\\b" docs/` | 2 matches, both in `jsdoc-style-guide.md` (Phase 13 output; the filler rule is enumerated there). Zero matches in Phase 15 authored docs. | PASS |
| docs/ has no npm/yarn/pnpm commands | `grep -rnE "\\bnpm install\\b\|\\byarn \\b\|\\bpnpm \\b" docs/` | Zero matches | PASS |
| Phase-close validator runs | `bun run scripts/validate-docs.ts` | **Script does not exist — command would fail** | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DOCS-01 | 15-03 | Getting Started guide | SATISFIED | `docs/getting-started.md` (117 lines) verified against roadmap SC-1 |
| DOCS-02 | 15-03 | Architecture Overview with Mermaid diagrams | SATISFIED | `docs/architecture.md` (156 lines) with 4 Mermaid diagrams |
| DOCS-03 | 15-04 | "Add a Module" step-by-step tutorial | SATISFIED | `docs/add-a-module.md` (165 lines) with 10 steps |
| DOCS-04 | 15-04 | Configuration guide | SATISFIED | `docs/configuration.md` (104 lines) with env catalog |
| DOCS-05 | 15-04 | Testing guide | SATISFIED | `docs/testing.md` (121 lines) with mock patterns |
| DOCS-06 | 15-05 | Integration doc: better-auth | SATISFIED | `docs/integrations/better-auth.md` (101 lines) |
| DOCS-07 | 15-05 | Integration doc: Stripe/Pagar.me billing | SATISFIED | `docs/integrations/billing.md` (127 lines) |
| DOCS-08 | 15-05 | Integration doc: BullMQ | SATISFIED | `docs/integrations/bullmq.md` (137 lines) |
| DOCS-09 | 15-05 | Integration doc: Email (Resend + React Email) | SATISFIED | `docs/integrations/email.md` (138 lines) |

All 9 DOCS-* requirements declared across Plans 15-03, 15-04, 15-05 are satisfied. Plans 15-01 and 15-02 carry `requirements: []` (infrastructure + D-05 example module extension, not requirement-bound).

No orphaned requirements: REQUIREMENTS.md maps DOCS-01..09 to Phase 15 and every ID is accounted for in at least one plan's frontmatter.

### Anti-Patterns Found

Phase 15 produced documentation and a small code extension of `packages/modules/example`. Anti-pattern scan focused on the Phase 15 code changes and the authored docs.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/modules/example/src/jobs/process-followup.ts` | 17-18 | Handler casts `data as { exampleId: string; tenantId: string }` without runtime validation — contradicts the security guideline documented in the new `docs/integrations/bullmq.md` Security section | Warning | Already identified in 15-REVIEW.md IN-02. Does not block the phase goal but the demo handler fails to model its own documented security invariant. Candidate for follow-up polish phase. |
| `docs/integrations/bullmq.md` | ~78, 99, 120 | Documents `ctx.enqueue(...)` as the primary job-dispatch path from command handlers, but `HandlerContext.enqueue` is never populated in the codebase | Warning | Already identified in 15-REVIEW.md WR-01. The actual pattern (event-bus hooks) IS documented correctly in `add-a-module.md` Step 6 and `configuration.md`, so the core "Add a Module" tutorial does not mis-teach. However, a reader landing on bullmq.md first may write non-functional code. Does not block phase goal but reduces teaching quality. |
| `docs/architecture.md` | CQRS sequenceDiagram | Contains `Cmd->>Q: ctx.enqueue("example:process-followup", payload)` line that implies enqueue happens inline from the command | Warning | Same root cause as WR-01. The diagram should either show the event-bus hook lane or drop the direct-enqueue arrow. |
| `docs/add-a-module.md` | ~25 | Cites `scoped-db.ts::injectTenantId` — no such exported symbol exists in the scoped-db helper | Info | Already identified in 15-REVIEW.md WR-02. Citation should anchor to `scopedDb` factory. |
| `docs/add-a-module.md` | ~150 | Smoke-test curl uses `/api/{your-module}` but the example module's routes.ts uses `prefix: "/examples"` (no `/api` prefix) | Info | Already identified in 15-REVIEW.md WR-03. A user copying the example verbatim would hit 404. |
| `docs/configuration.md` / `docs/architecture.md` | Various | Cited line ranges for `apps/api/src/index.ts:25-28` and `:27` drift from the actual `modules:` array location | Info | Already identified in 15-REVIEW.md WR-04. Off-by-one citations. |
| `docs/README.md` | ~28 | Hyphenates `b-a-s-i-c-a-l-l-y`, `s-i-m-p-l-y`, `j-u-s-t` to pass its own filler-word regex | Info | Already identified in 15-REVIEW.md IN-06. Self-referential regex-evasion is visually unusual but technically consistent with the rule. Non-blocking. |

None of the warnings are phase-blockers for the stated goal ("A new developer can clone, understand, run, add a module, and configure integrations by reading in-repo docs alone"). The `ctx.enqueue` mis-teach is the most substantive warning but the correct pattern is also documented; a careful reader reaches the right answer. All six warnings were surfaced in the 15-REVIEW.md code review and can be addressed in a follow-up polish pass.

### Human Verification Required

Phase 15 is primarily documentation. Several qualities cannot be verified by automated checks and require a human reviewer to confirm.

#### 1. Mermaid diagrams render correctly in GitHub PR preview

**Test:** Push the Phase 15 branch, open a PR, and view `docs/architecture.md` and each `docs/integrations/*.md` file in GitHub's preview.
**Expected:** All 8 Mermaid diagrams render without parse errors. Box labels and arrow labels are legible at default zoom.
**Why human:** GitHub's Mermaid renderer can reject syntactically valid Mermaid that works in local previewers. Only GitHub's actual render confirms publication-ready diagrams.

#### 2. Getting Started walkthrough succeeds end-to-end on a fresh clone

**Test:** On a fresh checkout (no local state), a developer runs every command in `docs/getting-started.md` in order: `bun install`, create `.env` from the template, `bun docker:up`, `bun db:migrate`, `bun api`, `bun worker`, `bun test`.
**Expected:** Each step completes without error. API serves on port 3000. Worker starts and exposes health endpoint on 3001. Test suite passes.
**Why human:** The doc cites the commands but does not rerun them. A reviewer on a clean machine is the only check that the documented flow actually works front to back.

#### 3. "Add a Module" tutorial produces a working module

**Test:** A developer follows `docs/add-a-module.md` steps 1-10 in a scratch branch, creates a throwaway module, runs `bun run typecheck`, `bun test packages/modules/{new-module}`, starts `bun api` and `bun worker`, and exercises the CRUD endpoint.
**Expected:** Module registers in `ModuleRegistry`, routes serve, worker starts a BullMQ worker for the new job, tests pass.
**Why human:** The tutorial is step-by-step prose; whether it actually works for a new reader requires a reader attempting it. Also catches the `WR-03` routes-prefix issue if the reader hits the documented `/api/{your-module}` endpoint.

#### 4. Integration docs' cited line ranges remain accurate

**Test:** Spot-check 5-10 randomly selected `path:line-line` citations across the four integration docs (e.g., `routes.ts:52-114`, `auth.ts:70-82`, `send-email.ts:15-24`). Open each and confirm the cited range matches the documented content.
**Expected:** Every sampled citation points to the code the prose describes.
**Why human:** Line ranges drift with edits. A reviewer's cursory read against the live files is the only check that every citation is correct. The `WR-04` drift on `index.ts:25-28` shows that at least some citations have already slipped by one line.

#### 5. Webhook smoke test against a real Stripe/Pagar.me test account

**Test:** Configure a throwaway Stripe test account, run `bun docker:up` + `bun api` + `bun worker`, follow the smoke test in `docs/integrations/billing.md`.
**Expected:** A 200 response on `GET /api/billing/subscription/status` with a valid session cookie; webhook delivery processed through the verify-signature → normalize → idempotency-check → enqueue flow described in the sequenceDiagram.
**Why human:** External service integration. Programmatic verification would require mocking Stripe, which the smoke test explicitly wants to avoid (the smoke test is the check that the live integration works).

#### 6. Email dispatcher sends via Resend on a real account

**Test:** Configure a Resend test key, trigger a password-reset or magic-link flow from a browser, observe the email arrives.
**Expected:** Worker log shows `Job started` for `email:send`, followed by a Resend API success. Email arrives in the target inbox with the `password-reset` template rendered.
**Why human:** External service integration. Also confirms the graceful-skip-without-`RESEND_API_KEY` branch documented in Gotchas (by running WITHOUT a key and confirming the worker logs the skip message).

### Gaps Summary

**One goal-blocking gap:** `scripts/validate-docs.ts` — the phase-close validator that was declared in Plan 15-05's `must_haves.artifacts` and had a full Task 5 block in the plan — was never created. The 15-05-SUMMARY documents only Tasks 1-4. No `scripts/` directory exists in the repo root. The script was meant to mechanize three invariants (no `@baseworks/test-utils` import in docs/, no leaked provider-secret shapes, Mermaid fence floor of 8 across docs/). All three invariants are currently satisfied in the committed docs tree (verified manually during this verification), so the gap is not a content/quality regression — it is a missing automated gate. Closing the gap requires creating the script per the Plan 15-05 Task 5 specification, running it once to confirm it exits 0 against the current tree, and committing it with the existing `docs(15-05):` naming convention.

**Content-quality warnings (not goal-blocking):** The 15-REVIEW.md code review found 4 warnings and 7 info items across the phase outputs. The two most substantive (`ctx.enqueue` mis-teach in bullmq.md and architecture.md CQRS diagram; `scoped-db.ts::injectTenantId` non-existent symbol in add-a-module.md) are candidates for a follow-up polish pass. They do not block the stated phase goal — the correct event-bus-hook pattern is documented in `add-a-module.md` Step 6 and `configuration.md`, so a reader working through the tutorial reaches working code — but they degrade teaching consistency and should be corrected before the milestone closes.

**Human verification items:** Six distinct qualities cannot be verified programmatically (Mermaid GitHub rendering, end-to-end getting-started walkthrough, tutorial-to-working-module path, citation accuracy spot-checks, Stripe/Pagar.me integration smoke test, Resend email smoke test). These do not block the `gaps_found` status but must be completed before declaring Phase 15 fully verified.

---

*Verified: 2026-04-18T00:36:00Z*
*Verifier: Claude (gsd-verifier)*
