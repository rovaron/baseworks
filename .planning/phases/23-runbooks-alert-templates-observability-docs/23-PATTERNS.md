# Phase 23: Runbooks, Alert Templates & Observability Docs - Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 27 (24 new + 3 modified)
**Analogs found:** 21 in-repo analogs / 27 files; 6 files have NO in-repo analog (templates from RESEARCH.md)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `docs/runbooks/db-down.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/redis-down.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/queue-backing-up.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/webhook-failures.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/auth-outage.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/otel-exporter-failing.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/bull-board-inaccessible.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/high-error-rate.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/runbooks/slow-checkout.md` | runbook (markdown) | static doc | (no analog — template from CONTEXT.md D-03) | template-only |
| `docs/alerts/sentry/<slug>.json` × 9 | sentry alert template (JSON) | static config | (no analog — Sentry REST API JSON shape from RESEARCH §Q1) | template-only |
| `docs/alerts/sentry/README.md` | guide (markdown) | static doc | `docs/integrations/bullmq.md` | role-match (different domain, same structure) |
| `docs/observability/README.md` | docs index (markdown) | static doc | `docs/README.md` | role-match (sub-index pattern) |
| `docs/observability/attributes.md` | style/glossary doc (markdown) | static doc | `docs/jsdoc-style-guide.md` | exact (single-canonical-style-guide precedent, Phase 13 D-01) |
| `docs/observability/cardinality.md` | rules/anti-patterns doc (markdown) | static doc | `docs/jsdoc-style-guide.md` | role-match (rules + anti-patterns + cross-links) |
| `docs/observability/trace-propagation.md` | concept doc + Mermaid (markdown) | static doc | `docs/architecture.md` | exact (Mermaid sequenceDiagram + file:line refs at same fidelity) |
| `scripts/validate-docs.ts` (MODIFIED) | validator (Bun script) | batch / file-scan | `scripts/validate-docs.ts` (self — extending existing 3 invariants) | self |
| `.github/workflows/validate.yml` (NEW) | CI workflow (YAML) | CI trigger → script | `.github/workflows/release.yml` | exact (Phase 18 D-16 second-workflow precedent) |
| `package.json` (MODIFIED) | root scripts wiring | n/a | `package.json` (existing `lint:als` script using `bash scripts/...` pattern) | self |
| `docs/README.md` (MODIFIED) | docs index | n/a | `docs/README.md` (existing Contents table — append rows) | self |

## Pattern Assignments

### `docs/runbooks/<slug>.md` (runbook, static doc) × 9

**Analog:** None in-repo (no existing runbooks). Template lives in CONTEXT.md D-03 + RESEARCH.md "Runbook section template" example.

**Section template** (RESEARCH.md lines 893–931 — copy verbatim into each runbook scaffold):

```markdown
# <Alert name>

> Source alert: [docs/alerts/sentry/<slug>.json](../alerts/sentry/<slug>.json)

## Trigger
<2 lines: which alert fires, matching Sentry template path>

## Symptoms
- <bullet 1: what the operator sees>
- <bullet 2>

## Triage

> These commands assume `docker-compose.yml` from the repo root. K8s/PaaS users translate to `kubectl exec` / equivalent.

> **Wait 5 minutes before action** to confirm this is not a deploy blip. The alert's frequency window is 5m (matches Sentry alert template's `frequency: 5`).

1. `docker compose ps` — confirm services up
2. ...

## Resolution

### Most likely: <root cause 1>
<command + rationale>

### If that did not work: <root cause 2>
<command + rationale>

## Escalation

If stuck >30 minutes:
- Open an issue / post in repo discussions
- Check upstream provider status page (<link>)
- Page yourself for the next attempt
```

**Citation style** — copy from `docs/architecture.md:1-13`:

```markdown
This document describes [...]. Each subsystem cites the source file it describes.
[...]
... see `packages/shared/src/types/module.ts`) [...]
... `apps/api/src/index.ts:27` [...]
```

Pattern: bare backticked file paths, optionally with `:line` or `:start-end` for ranges. NOT `[link text](path)` for source files (only relative `.md` paths use markdown link syntax — D-10's regex matches exactly that).

**Cross-runbook link form** — must match validator regex `\]\((\.\.?\/[\w\/.-]+\.md)(?:#[\w-]+)?\)` from RESEARCH §Q4:

```markdown
See [docs/observability/cardinality.md](../observability/cardinality.md) for the legitimate context fields list.
See [related: bull-board-inaccessible.md](./bull-board-inaccessible.md) when the queue UI is unreachable.
```

Use `./<sibling>.md` for same-directory and `../<dir>/<file>.md` for cross-directory. Validator resolves relative to the source file's directory.

**No frontmatter, no screenshots** (per D-04 + RESEARCH "Established Patterns") — match existing `docs/jsdoc-style-guide.md`, `docs/architecture.md`, `docs/getting-started.md` shape (plain markdown, no YAML).

---

### `docs/alerts/sentry/<slug>.json` (sentry alert template, static config) × 9

**Analog:** None in-repo. JSON shape comes from Sentry REST API (RESEARCH §Q1).

**Issue Alert skeleton** (RESEARCH.md lines 151–188 — copy verbatim, customize per-alert):

```json
{
  "name": "Auth outage — login error spike",
  "actionMatch": "all",
  "filterMatch": "all",
  "frequency": 5,
  "environment": "production",
  "conditions": [
    {
      "id": "sentry.rules.conditions.event_frequency.EventFrequencyCondition",
      "value": 50,
      "interval": "5m"
    }
  ],
  "filters": [
    {
      "id": "sentry.rules.filters.tagged_event.TaggedEventFilter",
      "key": "module",
      "match": "eq",
      "value": "auth"
    }
  ],
  "actions": [
    {
      "id": "sentry.mail.actions.NotifyEmailAction",
      "targetType": "Team",
      "fallthroughType": "AllMembers",
      "targetIdentifier": "OPERATOR_TEAM_ID"
    }
  ],
  "runbook_url": "../../runbooks/auth-outage.md",
  "_baseworks_meta": {
    "endpoint": "POST /api/0/projects/{org}/{project}/rules/",
    "slo_note": "Fires when ≥50 auth-tagged events occur within a 5m window.",
    "priority": "high"
  }
}
```

**Metric Alert skeleton** (RESEARCH.md lines 222–256):

```json
{
  "name": "Slow checkout — p95 latency",
  "dataset": "transactions",
  "query": "event.type:transaction transaction:/api/billing/checkout",
  "aggregate": "p95(transaction.duration)",
  "timeWindow": 5,
  "thresholdType": 0,
  "resolveThreshold": 1500,
  "triggers": [
    { "label": "warning", "alertThreshold": 2000, "thresholdType": 0, "actions": [] },
    { "label": "critical", "alertThreshold": 5000, "thresholdType": 0,
      "actions": [{ "type": "email", "targetType": "team", "targetIdentifier": "OPERATOR_TEAM_ID" }] }
  ],
  "projects": ["YOUR_PROJECT_SLUG"],
  "environment": "production",
  "runbook_url": "../../runbooks/slow-checkout.md",
  "_baseworks_meta": {
    "endpoint": "POST /api/0/organizations/{org}/alert-rules/",
    "slo_note": "Fast-burn alert: ≥2% monthly latency budget over a 5m window.",
    "priority": "medium"
  }
}
```

**Endpoint split** (RESEARCH §Q1):
- Issue Alerts: `auth-outage`, `webhook-failures`, `high-error-rate`, `otel-exporter-failing`, `bull-board-inaccessible`
- Metric Alerts: `db-down`, `redis-down`, `queue-backing-up`, `slow-checkout`

**`runbook_url` MUST be top-level string** (D-10 + RESEARCH §Q4 Pass B) — validator does `JSON.parse(file).runbook_url` and requires `typeof === "string"`. Path is repo-relative-from-the-JSON-file, so from `docs/alerts/sentry/db-down.json` the value `"../../runbooks/db-down.md"` resolves to `docs/runbooks/db-down.md`.

---

### `docs/alerts/sentry/README.md` (guide, static doc)

**Analog:** `docs/integrations/bullmq.md` (existing 4-Mermaid integration doc; same role: importable-config + how-to-wire).

**Header pattern** (lines 1–11):
```markdown
# BullMQ

## Overview

BullMQ is the job queue Baseworks uses for asynchronous work [...]. No module has to manage its own worker lifecycle.

## Upstream Documentation

- [BullMQ documentation](https://docs.bullmq.io)
- [BullMQ job options](https://docs.bullmq.io/guide/jobs/job-options)
```

Apply: open with 1-paragraph "what these alerts are + why they exist", then "Upstream Documentation" linking to Sentry API docs.

**Setup-style table** (lines 17–21):
```markdown
| Env var | Required | Purpose |
| --- | --- | --- |
| `REDIS_URL` | yes for `worker` or `all` roles | BullMQ's backing Redis. |
```

Apply: env-var table for `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

**Smoke test pattern** (lines 27–35):
```markdown
### Smoke test

\`\`\`bash
bun docker:up
bun worker
# From another shell, trigger a command that enqueues a job
curl -X POST http://localhost:3000/api/auth/forget-password [...]
\`\`\`
```

Apply: import smoke-test (RESEARCH.md lines 300–322 — three paths: sentry-cli api / curl / Sentry UI).

**Forward-looking note style** — copy from existing deferral notes (e.g., `docs/integrations/bullmq.md` mentions "current queues"). Add the v1.4+ Grafana note per CONTEXT.md D-13.

---

### `docs/observability/README.md` (docs index, static doc)

**Analog:** `docs/README.md` (top-level index — sub-index pattern).

**Reading-order + Contents pattern** (`docs/README.md:1-25`):
```markdown
# Baseworks Developer Documentation

This directory contains the in-repo developer documentation for Baseworks. The deliverables fall into four categories: [...]

---

## Reading Order

Start with `getting-started.md` to install [...]. Read `architecture.md` next [...].

## Contents

| Document | Purpose |
| --- | --- |
| [getting-started.md](./getting-started.md) | Prerequisites, install, env setup [...] |
| [architecture.md](./architecture.md) | Module system, CQRS flow [...] |
```

Apply: ~30 lines (per D-05) opening with "what observability looks like in this codebase", then a 4-row Contents table linking to `attributes.md`, `cardinality.md`, `trace-propagation.md` (the README itself is the 4th file).

---

### `docs/observability/attributes.md` (glossary, static doc)

**Analog:** `docs/jsdoc-style-guide.md` (exact match — Phase 13 D-01 single-canonical-style-guide precedent; one file consumed by many other files).

**Opener pattern** (`docs/jsdoc-style-guide.md:1-9`):
```markdown
# JSDoc Style Guide

This guide standardizes JSDoc across the Baseworks codebase. All exported symbols
(functions, types, interfaces, classes, constants) must have a JSDoc block unless
explicitly exempted. The goal is consistent IDE tooltips, self-documenting APIs,
and maintainable inline documentation that stays accurate as the code evolves.

---
```

**General-rules pattern** (lines 10–23):
```markdown
## General Rules

- **Line width:** 100 characters max [...]
- **Indent:** 2-space indent [...]
- **No `@type` in `.ts` files:** TypeScript already expresses types [...]
- **Always include `@param` and `@returns`:** Even when TypeScript expresses [...]
- **Technical-precise tone:** Describe what the code does [...]
```

Apply: open with "this guide is the canonical attribute glossary", then a "General Rules" section enumerating the 5-column table convention from CONTEXT.md D-05 (Name | Lives on (span/log/metric) | Type | Example value | Cardinality risk).

**File-line citation pattern** — D-07 mandates 5-line snippets. Use `docs/architecture.md:13`'s style: bare backticked path. Cite `packages/observability/src/context.ts:43-51` for the `ObservabilityContext` interface (verified by RESEARCH "File Refs Verified" table).

---

### `docs/observability/cardinality.md` (rules/anti-patterns, static doc)

**Analog:** `docs/jsdoc-style-guide.md` (rules + cross-links).

**5-line snippet citation pattern** (per D-07):
- Cite `packages/observability/src/lib/scrub-pii.ts:34-52` (DEFAULT_DENY_KEYS array — verified RESEARCH §"File Refs Verified")
- Embed 5-line excerpt with leading source comment (per `docs/README.md:36`):
  ```typescript
  // From packages/observability/src/lib/scrub-pii.ts:34-38
  const DEFAULT_DENY_KEYS = [
    "password", "token", "authorization", "cookie", "set-cookie",
    // ... full denylist (17 keys)
  ];
  ```

**Cross-link to runbooks** — uses the validator-recognized form (D-10):
```markdown
See [otel-exporter-failing.md](../runbooks/otel-exporter-failing.md) for the operator-side cardinality-blowup recovery path.
```

---

### `docs/observability/trace-propagation.md` (concept doc + Mermaid, static doc)

**Analog:** `docs/architecture.md` (exact match — same Mermaid+citations fidelity).

**Mermaid sequenceDiagram pattern** (`docs/architecture.md:57-76`):
```markdown
\`\`\`mermaid
sequenceDiagram
  participant Route as Elysia route handler
  participant Bus as CqrsBus
  participant Cmd as defineCommand handler
  participant DB as scopedDb
  participant EB as TypedEventBus
  [...]

  Route->>Bus: bus.execute("example:create", input, ctx)
  Bus->>Cmd: handler(input, ctx)
  Cmd->>DB: ctx.db.insert(table).values(...)
  DB-->>Cmd: Result row
  [...]
\`\`\`
```

Apply: 2 Mermaid diagrams (D-06) — copy structures verbatim from RESEARCH.md lines 344–412 (sequenceDiagram + stateDiagram-v2 pre-built).

**Box-label rule** (`docs/README.md:43`):
> "Every box label uses a concrete code identifier (`ModuleRegistry`, `CqrsBus`, `TypedEventBus`, `scopedDb`, `PaymentProvider`) that matches an actual file or class name [...]. Abstract labels such as 'Bus' or 'Database Layer' are forbidden."

Apply: every participant in the new diagrams must be a verified symbol per RESEARCH "File Refs Verified" table:
- `wrapQueue` → `packages/observability/src/wrappers/wrap-queue.ts:43-46`
- `obsContext` → `packages/observability/src/context.ts:57`
- `wrapProcessorWithAls` → `packages/queue/src/index.ts` (~line 70+)

**Permitted-syntaxes constraint** (`docs/README.md:42`): only `flowchart`, `sequenceDiagram`, `stateDiagram-v2`. The two new diagrams use `sequenceDiagram` + `stateDiagram-v2` — both compliant.

**5-line snippet citation pattern** — same as `attributes.md`. Cite `packages/observability/src/wrappers/wrap-queue.ts:74-83` for the W3C carrier write site.

---

### `scripts/validate-docs.ts` (MODIFIED — extend with 4th invariant)

**Analog:** `scripts/validate-docs.ts` itself (existing 3 invariants establish the pattern).

**Existing imports + ROOT pattern** (lines 17–25):
```typescript
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Use fileURLToPath so Windows gets "C:\\Projetos\\baseworks" (no leading slash).
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const docsGlob = new Bun.Glob("docs/**/*.md");
```

Apply: add `existsSync` to the `node:fs` imports and `dirname` to the `node:path` imports:
```typescript
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
```

**Existing failure-emission pattern** (lines 46–49):
```typescript
console.error(
  `[validate-docs] FAIL: ${relPath} contains forbidden string "@baseworks/test-utils" (${forbidden.length}x). Use the relative path "../../../__test-utils__/..." instead.`,
);
failures++;
```

Apply: 4th invariant uses identical `[validate-docs] FAIL: ${relPath}:${lineNum}: ...` shape (D-11) — see RESEARCH §Q4 for full code excerpts.

**Existing in-loop invariant placement** (lines 39–66) — invariant 4 Pass A (cross-runbook markdown links) lands inside the same `for await (const relPath of docsGlob.scan(...))` loop, gated by `if (relPath.startsWith("docs/runbooks/"))`. Pass B (Sentry alert JSON) lands as a NEW collector pass after the existing loop because the glob differs (`docs/alerts/sentry/*.json`).

**Existing Mermaid floor literal** (line 69):
```typescript
if (mermaidTotal < 8) {
  console.error(
    `[validate-docs] FAIL: found ${mermaidTotal} Mermaid fenced blocks across docs/; D-01 requires at least 8 (4 in docs/architecture.md + 1 per integration doc).`,
  );
  failures++;
}
```

Apply: change literal `8 → 11` and update the error message to reference `docs/observability/trace-propagation.md` (per D-06).

**Existing exit semantics** (lines 78–82) — keep unchanged. Hard-fail with exit 1 (D-11, no allowlist).

---

### `.github/workflows/validate.yml` (NEW)

**Analog:** `.github/workflows/release.yml` (Phase 18 D-16 — first workflow; this is the second per D-12).

**Triggers + checkout pattern** (`release.yml:3-24`):
```yaml
name: Release — upload source maps

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  upload-sourcemaps:
    name: Build + upload source maps to Sentry
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
```

Apply: change triggers to `pull_request` + `push` to `main` (D-12); keep `actions/checkout@v4` and `runs-on: ubuntu-latest`. `fetch-depth: 0` is not strictly needed but safe to mirror for consistency.

**Setup-Bun pattern** (`release.yml:26-29`):
```yaml
      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
```

Apply verbatim.

**Install + run pattern** (`release.yml:37-38`):
```yaml
      - name: Install dependencies
        run: bun install --frozen-lockfile
```

Apply verbatim, then add a single `bun run validate` step. Full file shape in RESEARCH.md lines 935–962.

---

### `package.json` (MODIFIED — add `validate` script)

**Analog:** `package.json` itself (existing `lint:als` script demonstrates the `bun script.sh`-style entry).

**Existing scripts pattern** (lines 11–13):
```json
"lint": "biome check . && bun run lint:als",
"lint:als": "bash scripts/lint-no-enterwith.sh",
"lint:fix": "biome check --write .",
```

Apply: add new entry between `lint:als` and `lint:fix` (or grouped with `typecheck`/`test` — planner picks):
```json
"validate": "bun scripts/validate-docs.ts",
```

Per RESEARCH §Q4: this script does NOT exist today (CONTEXT.md is wrong on that point). Adding it is required for `validate.yml`'s `bun run validate` step to work.

---

### `docs/README.md` (MODIFIED — append Operations section)

**Analog:** `docs/README.md` itself (existing Contents table — append rows below).

**Existing table pattern** (lines 11–24):
```markdown
## Contents

| Document | Purpose |
| --- | --- |
| [getting-started.md](./getting-started.md) | Prerequisites, install, env setup, run dev server, run tests. |
| [architecture.md](./architecture.md) | Module system, CQRS flow, request lifecycle, and tenant scoping with Mermaid diagrams. |
| [add-a-module.md](./add-a-module.md) | Annotated walkthrough of packages/modules/example for creating a new module end to end. |
[...]
| [jsdoc-style-guide.md](./jsdoc-style-guide.md) | JSDoc conventions for source files (Phase 13 output). |
```

Apply: append a new `## Operations` section (per RESEARCH §Q6) with rows linking to `observability/README.md`, the 3 concept files, `runbooks/`, and `alerts/sentry/README.md`. Full pattern in RESEARCH.md lines 619–634.

---

## Shared Patterns

### Cross-link form (validator-recognized)
**Source:** `docs/architecture.md:51` (existing) + `scripts/validate-docs.ts` Pass A regex
**Apply to:** All runbooks (D-10 only enforces inside `docs/runbooks/`)
```markdown
See [add-a-module.md](./add-a-module.md) for the annotated walkthrough.
```

Validator regex: `\]\((\.\.?\/[\w\/.-]+\.md)(?:#[\w-]+)?\)`. Use `./<sibling>.md` or `../<dir>/<file>.md`. Anchors (`#section`) are tolerated but not validated.

### File-path citation
**Source:** `docs/README.md:30-36`
**Apply to:** All runbooks + observability concept docs
- Bare backticked path for files: `` `packages/observability/src/context.ts` ``
- With line range for code: `` `packages/observability/src/context.ts:43-51` ``
- 5-line inline snippet (per D-07) MUST begin with source comment:
  ```typescript
  // From packages/observability/src/context.ts:43-51
  ```

### Mermaid block convention
**Source:** `docs/README.md:38-44`
**Apply to:** `docs/observability/trace-propagation.md` (only)
- Permitted: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`
- Forbidden: deprecated `graph` keyword, abstract labels like "Bus" / "Database Layer"
- Every box label MUST match a real file/class/function name in the repo

### Tone
**Source:** `docs/README.md:26-28`
**Apply to:** Observability concept docs (declarative, present-tense, technical-precise)
- Forbidden filler words: "basically", "simply", adverbial "just"
- No emojis
- Runbooks (per CONTEXT.md "Claude's Discretion") — second-person imperative ("Run `docker compose ps` to verify…") is canonical for solo-operator audience. This DEVIATES from the docs/ default tone but is explicitly approved.

### No frontmatter
**Source:** existing `docs/jsdoc-style-guide.md`, `docs/architecture.md`, `docs/getting-started.md` (none have YAML frontmatter)
**Apply to:** All new `.md` files (D-03 explicit + RESEARCH "Established Patterns")

### Failure-emission shape
**Source:** `scripts/validate-docs.ts:46-49`
**Apply to:** validator 4th invariant (both passes)
```typescript
console.error(`[validate-docs] FAIL: ${relPath}:${lineNum}: ${target} → target not found at ${resolved}`);
failures++;
```

### CI workflow setup chain
**Source:** `.github/workflows/release.yml:21-38`
**Apply to:** `validate.yml` (verbatim mirror)
```yaml
- uses: actions/checkout@v4
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest
- run: bun install --frozen-lockfile
```

---

## No Analog Found

Files with no close in-repo analog (planner uses RESEARCH.md / CONTEXT.md templates instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `docs/runbooks/<slug>.md` × 9 | runbook | static doc | No existing runbooks in the repo. Template lives in CONTEXT.md D-03 + RESEARCH.md "Runbook section template" code block (lines 893–931). Each runbook is the FIRST of its kind — section-shape consistency enforced by `runbook-section-shape.test.ts` (Wave 0 test per RESEARCH §Q7). |
| `docs/alerts/sentry/<slug>.json` × 9 | sentry alert template | static config | No existing alert JSON files in the repo. Shape comes from Sentry REST API (RESEARCH §Q1). Two skeleton variants (Issue Alert + Metric Alert) ship as copy-paste templates in this PATTERNS.md above. |

---

## Metadata

**Analog search scope:**
- `docs/**/*.md` — found `architecture.md`, `jsdoc-style-guide.md`, `README.md`, `integrations/*.md` (4 files), `getting-started.md`, `configuration.md`, `add-a-module.md`, `testing.md`
- `.github/workflows/**` — found `release.yml` only
- `scripts/**/*.ts` — found `validate-docs.ts` (the file being extended) + `lint-no-enterwith.sh` (different role: lint, not validate)
- `package.json` (root)

**Files scanned:** 17 (8 markdown + 1 yaml + 2 scripts + 1 json + 5 source-citation targets verified by RESEARCH §"File Refs Verified")

**Pattern extraction date:** 2026-04-28

**Key finding:** Phase 23 has STRONG analog coverage on the tooling axis (validator + workflow + package.json) and the observability concept doc axis (architecture.md + jsdoc-style-guide.md), but ZERO analog coverage on the runbook + Sentry alert JSON axis (these are first-of-kind in the repo). The runbook template and JSON skeletons are explicitly defined in CONTEXT.md D-03 + RESEARCH §Q1 to fill that gap. Wave 0 tests (per RESEARCH §Q7) enforce structural consistency since there are no in-repo precedents to drift toward.
