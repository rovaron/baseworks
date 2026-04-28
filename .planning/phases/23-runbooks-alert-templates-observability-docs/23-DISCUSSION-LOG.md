# Phase 23: Runbooks, Alert Templates & Observability Docs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `23-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 23-runbooks-alert-templates-observability-docs
**Areas discussed:** Runbook content & audience, Observability concepts doc layout, CI runbook_url integrity check
**Areas skipped (Claude defaults applied):** Alert templates (Grafana YAML scope, Sentry alert format, SLO burn-rate translation)

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Alert templates | Grafana YAML scope + Sentry format + SLO burn-rate translation | |
| Runbook content & audience | Style, depth, audience, command examples, screenshots | ✓ |
| Obs concepts doc layout | File split, Mermaid coverage, code-reference density, cardinality enforcement | ✓ |
| CI runbook_url check | Location, source classes, failure mode, toolchain integration | ✓ |

**User's choice:** Three areas selected; alert-templates skipped (Claude defaults applied — see CONTEXT.md D-13..16).

---

## Runbook content & audience

### Q1: Who is the runbook audience?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo fork-user (Recommended) | One developer-operator wearing all hats. Escalation = "if stuck >30 min, post in repo discussions / open an issue." Matches Baseworks' starter-kit positioning. | ✓ |
| Team operator w/ escalation tiers | L1 (triage) → L2 (subject-matter expert) → L3 (vendor/infra). Names roles, links to incident-response process. | |
| Both, side-by-side | Each runbook has a short solo path + a longer team path. Doubles content. | |

**User's choice:** Solo fork-user (Recommended)

### Q2: Command-line examples — deployment assumption?

| Option | Description | Selected |
|--------|-------------|----------|
| Docker-Compose-assumed (Recommended) | `docker compose ps`, `docker compose logs api --tail 100`, `docker compose exec postgres psql ...`. Concrete, copy-pasteable. | ✓ |
| Deployment-agnostic abstractions | "Check API logs" / "Connect to Postgres" — prose only, no copy-paste commands. | |
| Tabbed: Compose + bare-metal + K8s | Three command variants per Triage step. Highest maintenance burden. | |

**User's choice:** Docker-Compose-assumed (Recommended)

### Q3: Runbook content depth — length per runbook?

| Option | Description | Selected |
|--------|-------------|----------|
| Tight 1-page checklist (Recommended) | ~150–300 lines markdown. Trigger=2 lines, Symptoms=bullet list, Triage=numbered checklist, Resolution=2–3 fix paths, Escalation=short. Optimized for 3am readability. | ✓ |
| Thorough 2–3-page narrative | ~500–800 lines markdown. Prose explanations, alternative root-cause trees, deeper architecture links. | |
| Hybrid: TL;DR + deep dive | TL;DR top + deep-dive bottom. Lets 3am-operator scan top, post-mortem author read bottom. | |

**User's choice:** Tight 1-page checklist (Recommended)

### Q4: Screenshots / visual aids?

| Option | Description | Selected |
|--------|-------------|----------|
| Text-only, no screenshots (Recommended) | No image files. Mermaid diagrams allowed inline for trace-propagation flows. Avoids screenshot rot. | ✓ |
| Sparingly: bull-board + Sentry only | 2–3 screenshots concentrated where the visual is genuinely needed. | |
| Liberal screenshots | Whenever a runbook step involves a UI screen. | |

**User's choice:** Text-only, no screenshots (Recommended)

---

## Obs concepts doc layout

### Q1: How to split docs/observability/ across files?

| Option | Description | Selected |
|--------|-------------|----------|
| Three files + README index (Recommended) | `README.md` (1-page index), `attributes.md` (glossary table), `cardinality.md` (rules + anti-patterns), `trace-propagation.md` (Mermaid + walkthrough). Easier to deep-link. | ✓ |
| Single combined README.md | All three as H2 sections. Simpler URL space; risk of growing past 800 lines. | |
| Three files, no README | Skip the index; `docs/README.md` links to the three files directly. | |

**User's choice:** Three files + README index (Recommended)

### Q2: Mermaid diagram coverage for trace-propagation?

| Option | Description | Selected |
|--------|-------------|----------|
| Full sequenceDiagram + state diagram (Recommended) | sequenceDiagram for HTTP→DB→enqueue→worker; stateDiagram-v2 for ALS context lifecycle. Raises Mermaid floor 8 → 11. | ✓ |
| Sequence diagram only | One sequenceDiagram; ALS lifecycle in prose. Simpler. | |
| ASCII art only, no Mermaid | Hand-drawn ASCII boxes-and-arrows. Avoids Mermaid floor coupling. | |

**User's choice:** Full sequenceDiagram + state diagram (Recommended)

### Q3: Code-reference density — how concrete?

| Option | Description | Selected |
|--------|-------------|----------|
| File:line refs + 5-line snippets (Recommended) | Cite `packages/queue/src/wrap-queue.ts:42` with a 5-line excerpt. Stays current via grep-checks. | ✓ |
| Conceptual only, no code | Prose explanations, no file:line references. Doc stays evergreen but less actionable. | |
| Heavy code embedding (>20-line blocks) | Embed full functions in markdown. Most concrete; highest maintenance burden. | |

**User's choice:** File:line refs + 5-line snippets (Recommended)

### Q4: Cardinality guide — enforcement mechanism?

| Option | Description | Selected |
|--------|-------------|----------|
| Doc-only guide + denylist examples (Recommended) | Prose guide + Baseworks-specific high-card values enumerated. Cross-link Phase 19 scrubPii denylist. No new lint rule. | ✓ |
| Doc + new Biome lint rule | GritQL rule (similar to Phase 19 enterWith ban) flagging `metric.add(name, value, { tenantId, ... })`. | |
| Doc + grep-based check in validate-docs.ts | Grep-based check; lighter than Biome, weaker than AST. | |

**User's choice:** Doc-only guide + denylist examples (Recommended)

---

## CI runbook_url check

### Q1: Where does the runbook_url check live?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend scripts/validate-docs.ts (Recommended) | Add a 4th invariant alongside forbidden-import / secret-shape / Mermaid-floor. Single CI gate, single local command. | ✓ |
| New dedicated scripts/validate-alerts.ts | Split alert validation into its own script. Cleaner SRP; two CI commands. | |
| Both: extend + new script | Generic broken-link in validate-docs.ts + dedicated parser in validate-alerts.ts. Most coverage. | |

**User's choice:** Extend scripts/validate-docs.ts (Recommended)

### Q2: What does the check parse as a runbook_url source?

| Option | Description | Selected |
|--------|-------------|----------|
| Sentry templates + cross-runbook links (Recommended) | (a) Sentry alert template JSON files; (b) cross-runbook markdown links inside docs/runbooks/. README links covered through (b). | ✓ |
| Sentry templates only | runbook_url in alert templates only. Doesn't catch broken cross-references between runbooks. | |
| Every markdown link in docs/ | Generic broken-link checker across all of docs/. Risk of false positives on intentional dangling refs. | |

**User's choice:** Sentry templates + cross-runbook links (Recommended)

### Q3: Failure mode — what happens when a runbook_url is broken?

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-fail, exit 1 (Recommended) | Matches existing validator pattern. CI step blocks. Output = numbered list of broken refs. | ✓ |
| Warn only, exit 0 | Warnings to stderr, exit 0. Drift creeps back. Defeats success criterion 4. | |
| Hard-fail with allowlist override | Exit 1 but accept docs/.runbook-url-allowlist.txt. Useful for deferred runbooks. | |

**User's choice:** Hard-fail, exit 1 (Recommended)

### Q4: Where in the toolchain does the check run?

| Option | Description | Selected |
|--------|-------------|----------|
| bun run validate + GitHub Actions (Recommended) | Wired into existing `bun run validate` AND a new `.github/workflows/validate.yml`. Phase 18 already created `release.yml` — second workflow is cheap. | ✓ |
| bun run validate only (no GitHub Actions yet) | Local validator only. PR-time CI deferred to a future broader CI phase. | |
| Pre-commit hook via Husky | Block commits when validation fails. Husky isn't in the project; adding it isn't justified. | |

**User's choice:** bun run validate + GitHub Actions (Recommended)

---

## Wrap-up

### Q: Anything else before writing CONTEXT.md?

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context (Recommended) | Write CONTEXT.md now. Claude picks defaults for unselected Alert-templates area. | ✓ |
| Pin alert template details | Spend 1 question locking Alert-templates concretely. | |
| Explore another gray area | Surface 2–3 more gray areas based on what we've decided. | |

**User's choice:** I'm ready for context (Recommended)

---

## Claude's Discretion (Alert templates — unselected by user)

User did not select the Alert-templates gray area. Claude applied decisive defaults documented in CONTEXT.md D-13..16:

- **D-13:** Grafana alert YAML scope FULLY DROPPED (per Phase 21 deferral; milestone-roadmap deferral note authoritative over top-level ROADMAP mirror).
- **D-14:** Sentry alert configs ship as JSON files at `docs/alerts/sentry/<alert-slug>.json` — Sentry's native Issue-Alert / Metric-Alert REST API JSON shape. One file per alert, minimum 9 matching the runbook list.
- **D-15:** SLO burn-rate translates to Sentry-native vocabulary (`actionMatch: "all"` + 5-min frequency window for `for: 5m` equivalents; burn-rate math documented as one-line comments per JSON file).
- **D-16:** `docs/alerts/sentry/README.md` ships alongside the JSON files (~30-line guide on import, runbook_url path mapping, SLO translation).

These are decisive Claude-default decisions, not flexible. Downstream agents act on them.

---

## Deferred Ideas (mentioned during discussion)

Captured in CONTEXT.md `<deferred>` section. Highlights:

- Grafana alert YAML — revive in v1.4+ if fork user requests self-hosted Grafana wiring
- Generic broken-link detection across all of `docs/` — defer to v1.4 docs-quality phase
- Tabbed Compose+bare-metal+K8s command variants — Docker-Compose canonical
- Markdown frontmatter on runbooks — defer to v1.4 if alert-runbook cross-ref needs metadata
- Biome GritQL lint rule for cardinality — defer; lint authoring is phase-sized
- Runbook dry-run/test instructions — defer to v1.4 ops-quality phase
- README anchor verification in the validator — defer to v1.4

---

## Reviewed Todos (not folded)

- `.planning/todos/2026-04-26-harden-inbound-traceparent-trust-gate.md` (score 0.9, area: api) — keyword-incidental match. Belongs in a future security-hardening phase.
