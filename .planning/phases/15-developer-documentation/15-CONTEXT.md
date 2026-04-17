# Phase 15: Developer Documentation - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Author 9 in-repo markdown documents under `docs/` so a new developer can clone the repo, understand the architecture, run the project, add a module, and configure third-party integrations using in-repo content alone. Required deliverables (all v1.2 scope):

1. Getting Started guide — prerequisites, install, env setup, run dev, run tests (DOCS-01)
2. Architecture Overview with Mermaid diagrams — module system, CQRS flow, request lifecycle, tenant scoping (DOCS-02)
3. "Add a Module" step-by-step tutorial using `packages/modules/example` as reference (DOCS-03)
4. Configuration guide — env vars, module config, provider selection, deployment config (DOCS-04)
5. Testing guide — test runner split, mock patterns for HandlerContext, how to test commands/queries (DOCS-05)
6. Integration doc: better-auth setup and customization (DOCS-06)
7. Integration doc: Stripe/Pagar.me billing configuration and adding providers (DOCS-07)
8. Integration doc: BullMQ queue setup and adding new job types (DOCS-08)
9. Integration doc: Email templates with Resend and React Email (DOCS-09)

Out of scope for this phase: TypeDoc auto-generated API reference (APIDOC-01/02 — v2), Contributing guide (COMM-01 — v2), Changelog/migration guide (COMM-02 — v2), external doc site (Docusaurus/VitePress).

</domain>

<decisions>
## Implementation Decisions

### Mermaid diagrams
- **D-01:** Diagram count: 4 architecture diagrams (module system, CQRS flow, request lifecycle, tenant scoping) PLUS 1 sequence/flow diagram per integration doc = ~8 total Mermaid diagrams. Integration diagrams should cover: Stripe webhook flow (DOCS-07), magic-link auth flow (DOCS-06), BullMQ enqueue → worker → retry (DOCS-08), email queue → Resend send (DOCS-09).
- **D-02:** Diagram abstraction level: conceptual diagrams with **named code anchors** — boxes labeled with concrete component names (`ModuleRegistry`, `CqrsBus`, `EventBus`, `scopedDb`, `PaymentProvider`, etc.) that match the actual file/class names so readers can grep. Not abstract concept diagrams; not class-level UML.

### "Add a Module" tutorial
- **D-03:** Tutorial format: **annotated walkthrough of the existing `packages/modules/example` module**, not from-scratch prose. Reader is told "copy `packages/modules/example/`, rename, modify these specific lines". Stays in sync because the example module is real, runnable, type-checked code that other tests/builds touch.
- **D-04:** Tutorial scope: cover all four module surfaces — command + query + event emission + BullMQ worker handler. Reader sees the full module pattern, not just the minimum surface.
- **D-05:** **The example module must be extended in this phase** to support D-04. Add an event (e.g., `ExampleCreated`) emitted by the create command, plus a BullMQ worker that handles a follow-up job triggered by that event. This is a planned task in Phase 15 plans, not a side effect — the planner must include it before the tutorial is written.
- **D-06:** Tutorial assumes the Architecture Overview (DOCS-02) is a prerequisite — no inline re-explanation of CQRS, ModuleRegistry, EventBus, scopedDb concepts. Tutorial focuses on mechanics ("here's where you wire it in"), not on why the architecture is shaped this way.

### Third-party integration docs (DOCS-06..09)
- **D-07:** Per-integration document structure: a single doc per integration with two sections — **Setup** (env vars, config keys, module wire-up, smoke test) and **Extending** (how to add another provider/queue/job/template). One file per integration, not split into setup.md + extending.md.
- **D-08:** External-library coverage: explain **Baseworks-specific wiring** in detail (file paths, config keys, abstractions used, gotchas hit during integration). For library internals (better-auth APIs, Stripe SDK, BullMQ semantics, Resend API), **link to upstream official docs** rather than re-documenting them. No re-documenting upstream APIs.
- **D-09:** Every integration doc includes an "Add another X" section in its Extending portion:
  - DOCS-06 (better-auth): adding another OAuth provider via better-auth's plugin model
  - DOCS-07 (billing): adding a 3rd payment provider implementing the `PaymentProvider` port (mirroring how Pagar.me was added alongside Stripe)
  - DOCS-08 (BullMQ): adding a new queue + worker + job type
  - DOCS-09 (Resend/React Email): adding a new email template + send invocation
- **D-10:** Code blocks in integration docs follow a **mixed strategy**:
  - **Cite real files** (with `path:line` ranges) for full implementations or anything > ~10 lines. Citations stay accurate as code evolves.
  - **Inline snippets** for short usage examples (3-5 lines showing typical call sites) where the snippet rarely changes.
  This applies to all 9 docs, not only integrations.

### Tone & style
- **D-11:** Tone for reference docs (Architecture Overview, Configuration, Testing, all 4 integrations): same **technical-precise, API-ref tone** established in Phase 13's `docs/jsdoc-style-guide.md`. Formal, declarative, domain-terminology-first. No filler ("basically", "simply", "just"). (Carried forward from Phase 13.)

### Claude's Discretion
- **Information architecture in `docs/`:** folder structure (flat vs grouped subdirectories like `docs/guides/`, `docs/integrations/`, `docs/architecture/`), file naming conventions, navigation/index approach (root `docs/README.md` vs `docs/index.md` vs none), root-level `README.md` content (link to docs vs full quickstart).
- **Tone variance for Getting Started (DOCS-01):** whether DOCS-01 keeps the same formal API-ref tone or adopts a slightly warmer onboarding voice. Discretion within Phase 13 tone bounds.
- **Mermaid theme/styling:** color palette, direction (LR vs TD), alignment with GitHub's Mermaid renderer.
- **Snippet length budget:** exact threshold for "inline snippet" vs "file citation" (D-10 uses ~10 lines as a guideline; planner can adjust).
- **Doc cross-linking:** how docs reference each other (relative paths, anchor links, glossary).
- **Code-citation freshness mechanism:** how to keep `path:line` references accurate over time (manual review, lint script, deferred).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 15: Developer Documentation" — Phase goal, dependencies, requirements list, success criteria
- `.planning/REQUIREMENTS.md` §Documentation (DOCS-01 .. DOCS-09) — Each documentation deliverable with concrete bullet
- `.planning/PROJECT.md` §"Current Milestone: v1.2 Documentation & Quality" — Milestone goal and target features

### Tone & style precedent
- `docs/jsdoc-style-guide.md` — Phase 13 output; defines the technical-precise tone Phase 15 inherits for reference docs (D-11)

### Tutorial subject (DOCS-03)
- `packages/modules/example/src/index.ts` — Module registration entry point
- `packages/modules/example/src/commands/create-example.ts` — Command handler reference
- `packages/modules/example/src/queries/list-examples.ts` — Query handler reference
- `packages/modules/example/src/routes.ts` — Routes wiring reference
- `packages/modules/example/package.json` — Module package config reference

### Architecture diagram subjects (DOCS-02)
- `apps/api/src/core/registry.ts` — `ModuleRegistry` (module system diagram anchor)
- `apps/api/src/core/cqrs.ts` — `CqrsBus` (CQRS flow diagram anchor)
- `apps/api/src/core/event-bus.ts` — `TypedEventBus` (event flow anchor)
- `packages/db/src/scoped-db.ts` — `scopedDb` wrapper (tenant scoping diagram anchor)
- `apps/api/src/server.ts` (or equivalent entry) — Request lifecycle entry point

### Integration doc anchors (DOCS-06..09)
- `packages/modules/auth/src/` — better-auth wiring (DOCS-06)
- `packages/modules/billing/src/adapters/stripe-adapter.ts` — Stripe adapter implementing PaymentProvider port (DOCS-07)
- `packages/modules/billing/src/adapters/pagarme-adapter.ts` — Pagar.me adapter as the "added provider" reference (DOCS-07 Extending)
- `packages/modules/billing/src/ports/` (or wherever the `PaymentProvider` port is defined) — Port interface for "adding another provider" pattern (DOCS-07)
- `packages/queue/src/` — BullMQ queue/worker setup (DOCS-08)
- `apps/worker/src/` — Worker entrypoint (DOCS-08)
- `packages/modules/auth/src/__tests__/`, transactional email handlers — Resend + React Email integration (DOCS-09)

### Testing guide anchors (DOCS-05)
- `packages/modules/__test-utils__/` — Shared test utilities (mock factory; Phase 14 output)
- `packages/modules/billing/src/__tests__/pagarme-adapter.test.ts` — Reference adapter test pattern
- `packages/modules/billing/src/__tests__/billing.test.ts` — Reference for `bun:mock` `mock.module()` pattern
- `.planning/phases/14-unit-tests/14-CONTEXT.md` — Test mock strategy decisions (mock factory, behavioral tests, test depth)

### Configuration guide anchors (DOCS-04)
- `packages/config/src/` — Env validation, typed config
- `apps/api/src/server.ts`, `apps/worker/src/`, `apps/admin/`, `apps/web/` — Entrypoints whose config Driver each app
- `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.admin` — Deployment config

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/modules/example/`** — Already has `commands/create-example.ts`, `queries/list-examples.ts`, `routes.ts`, `index.ts`, `package.json`, `tsconfig.json`. This phase EXTENDS it (D-05) to add an event + BullMQ worker so the tutorial (D-04) can walk through all four module surfaces.
- **`docs/jsdoc-style-guide.md`** — Existing doc; sole entry in `docs/` so far. Provides the tone reference for new docs (D-11) and is the only existing piece of `docs/` information architecture.
- **`PaymentProvider` port + adapters** — Already shows the "add another provider" pattern in production. DOCS-07 Extending section can point readers directly at how Pagar.me was added alongside Stripe.
- **Phase 14 test infrastructure** — `__test-utils__/` mock factory, `bun:mock` patterns, behavioral test conventions all established. DOCS-05 documents what already exists rather than introducing new patterns.

### Established Patterns
- **Tone:** Phase 13's technical-precise, API-ref voice (per `docs/jsdoc-style-guide.md`) is the project standard for documentation. Phase 15 reference docs inherit it (D-11). Getting Started (DOCS-01) has discretion to be slightly warmer.
- **Module surface:** All modules follow `defineCommand`/`defineQuery` factory pattern with Zod validation, `HandlerContext` shape, `Result<T>` returns, optional event emission, optional BullMQ worker. The "Add a Module" tutorial documents this entire shape (D-04).
- **Pluggable adapters:** Billing already established the port-and-adapter pattern. better-auth uses its own plugin model. BullMQ uses queue-per-module convention. These are the patterns each integration doc explains (D-09 Extending sections).
- **Markdown-only docs:** No external doc tooling in scope (no Docusaurus, no VitePress, no Storybook). Plain markdown rendered by GitHub/IDE. Mermaid renders natively in GitHub.

### Integration Points
- **`docs/` directory** — Greenfield except for `docs/jsdoc-style-guide.md`. New docs land here; folder structure is Claude's discretion.
- **Root `README.md`** — Does not currently exist. Whether to add one and what it links to is Claude's discretion.
- **`packages/modules/example/`** — Modified in this phase (D-05) to add event + worker. Downstream impact: existing tests for the example module (if any) need to remain green; module registration in `apps/api/` may need updating if the worker is registered at a higher level.
- **Phase 13 + 14 outputs** — JSDoc style guide and test infrastructure are referenced from Phase 15 docs but not modified.

</code_context>

<specifics>
## Specific Ideas

- "Add another payment provider" should mirror the structure of how Pagar.me was added alongside Stripe — not invent a new pattern. The `PaymentProvider` port and the two existing adapters are the canonical example.
- Code-block strategy follows JSDoc Phase 13 spirit: cite real files when showing full implementations (so docs stay accurate), inline only short usage snippets (so reading flow isn't broken).
- Architecture diagrams should use names a reader can grep — `ModuleRegistry`, `CqrsBus`, `scopedDb` — not abstract labels like "Bus" or "Module Layer".
- Integration docs link out to upstream official docs (better-auth.com, stripe.com/docs, docs.bullmq.io, resend.com/docs) rather than re-documenting them; the value-add is in explaining Baseworks-specific wiring.

</specifics>

<deferred>
## Deferred Ideas

- **TypeDoc auto-generated API reference** (APIDOC-01, APIDOC-02) — v2. Requires monorepo TypeDoc config and per-package output. JSDoc annotations from Phase 13 enable this when scheduled.
- **Contributing guide** (COMM-01) — v2. Out of scope for v1.2.
- **Changelog and migration guide** (COMM-02) — v2.
- **External documentation site** (Docusaurus/VitePress) — Out of scope (project decision in REQUIREMENTS.md "Out of Scope" table). In-repo markdown is sufficient.
- **Storybook for UI components** — Out of scope (REQUIREMENTS.md). shadcn components are documented upstream.
- **Snapshot tests for UI components** — Out of scope (REQUIREMENTS.md).
- **Video tutorials** — Out of scope (REQUIREMENTS.md).
- **Code-citation freshness lint/automation** — Claude's discretion whether to introduce in this phase or defer; default deferred unless trivial.

</deferred>

---

*Phase: 15-developer-documentation*
*Context gathered: 2026-04-17*
