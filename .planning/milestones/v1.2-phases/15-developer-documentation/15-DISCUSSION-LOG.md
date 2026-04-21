# Phase 15: Developer Documentation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 15-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 15-developer-documentation
**Mode:** discuss (interactive)
**Areas discussed:** Mermaid diagram scope, Add-a-Module tutorial format, Third-party integrations coverage

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Info architecture & tone | docs/ folder structure + tone variation between Getting Started and reference docs | |
| Code examples sourcing | Cite real files vs standalone snippets | |
| Mermaid diagram scope | How many diagrams, where, at what abstraction level | ✓ |
| Add-a-Module tutorial format | Annotated walkthrough vs from-scratch prose vs skeleton | ✓ |
| Third-party integrations coverage | Free-text addition by user | ✓ |

**Notes:** User added "third party integrations covered" via Other. Information architecture & tone was deferred to Claude's Discretion in CONTEXT.md. Code examples sourcing was folded into the integrations discussion (D-10) since it surfaced naturally.

---

## Mermaid Diagram Scope

### Q1: Mermaid diagrams in integration docs — should the 4 integration guides include sequence/flow diagrams?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — 1 diagram per integration (Recommended) | One sequence/flow diagram per integration doc (Stripe webhook flow, BullMQ enqueue→worker→retry, magic-link auth flow, email queue→Resend). ~8 total diagrams. | ✓ |
| Architecture diagrams only | Keep diagrams in Architecture Overview only. Integration docs stay text-only. | |
| Only where flow is non-trivial | Add diagrams to integrations crossing async boundaries (Stripe, BullMQ); skip simpler ones. ~2 extra. | |

### Q2: Diagram abstraction level for the 4 architecture diagrams?

| Option | Description | Selected |
|--------|-------------|----------|
| Conceptual + named code anchors (Recommended) | Boxes labeled with concrete component names (ModuleRegistry, CqrsBus, EventBus, scopedDb). Names match actual files for grep. | ✓ |
| High-level conceptual only | Abstract concept boxes (Module, Bus, Event, Tenant scope) without coupling to file names. | |
| Detailed sequence diagrams | Method-level interactions with parameters/return types. Most accurate, heaviest to maintain. | |

### Continuation check

| Option | Description | Selected |
|--------|-------------|----------|
| Next area | Move to Add-a-Module tutorial format | ✓ |
| More questions on diagrams | Drill into Mermaid theme/styling, fallback rendering, exact location | |

---

## Add-a-Module Tutorial Format

### Q1: How should the 'Add a Module' tutorial be structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Annotated walkthrough of example module (Recommended) | Walk through existing packages/modules/example file-by-file with annotations. Reader: "copy example/, rename, modify these lines". Stays in sync because example is real, runnable, type-checked code. | ✓ |
| From-scratch step-by-step prose | Reader builds new module from empty directory, adding one file per step. Pedagogical but tutorial code can drift. | |
| Skeleton + checklist | Provide a starter-module-template folder + checklist. Most efficient, lightest on explanation. | |

### Q2: What should the tutorial actually build?

| Option | Description | Selected |
|--------|-------------|----------|
| Match existing example: 1 command + 1 query (Recommended) | Tutorial mirrors existing example: define one createX command + one listX query, register, hit via Eden Treaty. | |
| Extend further: command + query + event + worker | Tutorial adds event emission + BullMQ worker. Means example/ also needs event + worker added (new work). | ✓ |
| Two tracks: minimal + extended | Minimal track + Extended track as appendix. Best coverage but ~2x writing. | |

### Q3: Adding event + worker to the example module — how?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend example/ in this phase (Recommended) | Add event (e.g. ExampleCreated) emitted by create command + worker handling follow-up job. Tutorial walks through all 4 surfaces. Planned task in Phase 15. | ✓ |
| Tutorial uses example/ as-is + describes events/workers conceptually | Walkthrough shows existing command/query, then 'Adding events'/'Adding workers' sections with inline snippets. No example/ changes. | |
| Extend example/ with events only (skip worker) | Add event emission only. Worker patterns get inline snippet section. Middle ground. | |

### Q4: Tutorial's assumed prior reading?

| Option | Description | Selected |
|--------|-------------|----------|
| Architecture Overview is required prereq (Recommended) | Tutorial assumes reader knows CqrsBus, EventBus, ModuleRegistry. Focuses on mechanics. Shorter & non-redundant. | ✓ |
| Self-contained — re-explain core concepts inline | Repeats key architecture concepts before each step. Longer but standalone. | |

### Continuation check

| Option | Description | Selected |
|--------|-------------|----------|
| Next area | Move to Third-party integrations coverage | ✓ |
| More questions on tutorial | Drill into test scaffolding, register-into-config, snippet length budget | |

---

## Third-Party Integrations Coverage

### Q1: Audience focus per integration doc — first-time setup or extending what's wired?

| Option | Description | Selected |
|--------|-------------|----------|
| Both, in one doc per integration (Recommended) | Each doc has Setup section (env vars, config, smoke test) + Extending (add another provider/queue/template). Single source of truth. | ✓ |
| Setup + customization only | Cover wire-up + most common customizations. 'Adding new provider' goes in code comments. Tightest scope. | |
| Two-doc split | Per integration: setup.md + extending.md. Cleaner separation, doubles file count to 8. | |

### Q2: How much to explain external libraries vs link out?

| Option | Description | Selected |
|--------|-------------|----------|
| Explain Baseworks-specific wiring; link out for library internals (Recommended) | Cover HOW the integration wires into Baseworks (file paths, config, abstractions, gotchas). Link to upstream docs for library APIs. No re-documenting upstream. | ✓ |
| Self-contained — explain key library concepts inline | Cover enough library context that reader doesn't leave the page. Longer, can drift. | |
| Pure pointer doc | Mostly links to upstream. Lightest to maintain, readers hop between sources. | |

### Q3: 'Add another X' section in each integration?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes for all four (Recommended) | Every doc has 'Add another X' section. Aligns with 'fork & extend' core value. Billing already has PaymentProvider port as established pattern. | ✓ |
| Only where the abstraction explicitly supports it | Billing (PaymentProvider port), better-auth (plugin model), BullMQ (queue/worker). Not Resend (single send adapter). 3 of 4. | |
| Skip — leave to v2 docs | Setup + customization is enough for v1.2. 'Adding alternative providers' is advanced; defer to v2. | |

### Q4: Code blocks — cite real files or standalone snippets?

| Option | Description | Selected |
|--------|-------------|----------|
| Cite real files for full implementations; inline snippets for usage examples (Recommended) | Full implementations: cite path:line ranges. Usage examples (3-5 lines): inline snippets. Best of both. | ✓ |
| All inline snippets | Every code block is standalone. No jumping between docs and code. Snippets can drift. | |
| All file citations | Every code block is path:line range. Always accurate, reading flow broken. | |

### Continuation check

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Done discussing. Write CONTEXT.md. | ✓ |
| Explore more gray areas | Identify additional areas (information architecture, doc cross-linking, root README). | |

---

## Claude's Discretion

Areas left explicit in CONTEXT.md as Claude's discretion (planner/executor decides during planning or implementation):

- Information architecture in `docs/` (folder structure, naming, navigation index)
- Tone variance for Getting Started (DOCS-01) vs reference docs
- Mermaid theme/styling
- Snippet length threshold for inline vs file citation
- Doc cross-linking conventions
- Code-citation freshness mechanism
- Root `README.md` content (link to docs vs full quickstart)

## Deferred Ideas

Captured in CONTEXT.md `<deferred>`:

- TypeDoc auto-generated API reference (APIDOC-01/02) — v2
- Contributing guide (COMM-01) — v2
- Changelog/migration guide (COMM-02) — v2
- External doc site (Docusaurus/VitePress) — out of scope
- Storybook, snapshot tests, video tutorials — out of scope
- Code-citation freshness automation — discretion / default deferred
