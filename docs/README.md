# Baseworks Developer Documentation

This directory contains the in-repo developer documentation for Baseworks. The deliverables fall into four categories: Onboarding, Architecture, Guides, and Integrations.

---

## Reading Order

Start with `getting-started.md` to install the repo and run the dev server. Read `architecture.md` next to form a mental model of the module system, CQRS flow, request lifecycle, and tenant scoping. Then pick the relevant integration doc or guide for the task at hand. `add-a-module.md` assumes `architecture.md` has been read first (per D-06) and does not re-explain CQRS, `ModuleRegistry`, `TypedEventBus`, or `scopedDb`.

## Contents

| Document | Purpose |
| --- | --- |
| [getting-started.md](./getting-started.md) | Prerequisites, install, env setup, run dev server, run tests. |
| [architecture.md](./architecture.md) | Module system, CQRS flow, request lifecycle, and tenant scoping with Mermaid diagrams. |
| [add-a-module.md](./add-a-module.md) | Annotated walkthrough of packages/modules/example for creating a new module end to end. |
| [configuration.md](./configuration.md) | Environment variables, module loading, provider selection, and deployment configuration. |
| [testing.md](./testing.md) | Test runner scope, HandlerContext mocks, and patterns for testing commands, queries, and adapters. |
| [integrations/better-auth.md](./integrations/better-auth.md) | better-auth setup, magic-link flow, and adding OAuth providers. |
| [integrations/billing.md](./integrations/billing.md) | PaymentProvider port, Stripe and Pagar.me adapters, webhook flow, and adding a third provider. |
| [integrations/bullmq.md](./integrations/bullmq.md) | Queue conventions, worker entrypoint, and adding a new queue or job type. |
| [integrations/email.md](./integrations/email.md) | Resend dispatcher, React Email templates, and adding a new template. |
| [jsdoc-style-guide.md](./jsdoc-style-guide.md) | JSDoc conventions for source files (Phase 13 output). |

## Tone

All documents in this directory follow the technical-precise, API-reference tone established in [jsdoc-style-guide.md](./jsdoc-style-guide.md) §"General Rules" (lines 12-23). Sentences are declarative, present tense, active voice, and lead with domain terminology. Forbidden filler words: `b-a-s-i-c-a-l-l-y`, `s-i-m-p-l-y`, and the adverbial `j-u-s-t`. No emojis. No second-person exclamations. The `getting-started.md` document has discretion for a slightly warmer onboarding voice within these bounds (per D-11 and the Claude's Discretion note in `15-CONTEXT.md`).

## Code Citations

Documents reference source code using a mixed strategy (per D-10). Pick the narrowest form that stays accurate as the code evolves.

- Cite a file with `path:start-end` (for example, `packages/modules/billing/src/provider-factory.ts:32-75`) when the referenced code is longer than ~10 lines or likely to change.
- Prefer function-name anchors (for example, `provider-factory.ts::getPaymentProvider`) over line ranges when a stable named anchor exists. Named anchors are more resistant to drift.
- Inline short snippets verbatim (≤ 10 lines, stable usage examples) inside fenced `typescript` blocks. Every inline snippet MUST begin with a first-line comment naming its source, for example `// From packages/modules/example/src/commands/create-example.ts:22-34`.

## Mermaid Diagrams

Architecture and integration diagrams use Mermaid fenced blocks. GitHub renders them natively; no build tooling is required.

- Permitted syntaxes: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`. The deprecated `graph` keyword is forbidden — use `flowchart` instead.
- Every box label uses a concrete code identifier (`ModuleRegistry`, `CqrsBus`, `TypedEventBus`, `scopedDb`, `PaymentProvider`) that matches an actual file or class name, so readers can grep the repo from the diagram (per D-02). Abstract labels such as "Bus" or "Database Layer" are forbidden.
- Preview diagrams in a GitHub PR before committing, not only in an IDE plugin. Local Mermaid previewers can mask GitHub-specific rendering limits.

## Scope

This directory covers v1.2 deliverables DOCS-01 through DOCS-09. TypeDoc auto-generated API reference, contributing guide, and changelog are deferred to v2 (see `.planning/REQUIREMENTS.md` §"v2 Requirements").
