# Pitfalls Research

**Domain:** v1.2 Documentation & Quality -- JSDoc annotations, unit tests, developer documentation for existing TypeScript monorepo
**Researched:** 2026-04-16
**Confidence:** HIGH (well-trodden domain; patterns for adding docs/tests to existing codebases are extensively documented)

---

## Critical Pitfalls

### Pitfall 1: JSDoc That Duplicates TypeScript Types

**What goes wrong:**
Every function gets a JSDoc `@param` block that restates what TypeScript already expresses. `@param {string} tenantId - The tenant ID` adds zero information when the signature already says `tenantId: string`. The codebase gains 3,000 lines of documentation that is pure noise, obscures actual logic, and creates a maintenance burden where JSDoc and types inevitably drift apart.

**Why it happens:**
Coverage-driven JSDoc ("every exported function must have JSDoc") without guidelines on WHAT to document. Developers default to describing the obvious because it is easier than explaining the non-obvious. Automated tools and linters that flag "missing JSDoc" push toward completeness over usefulness.

**How to avoid:**
- Establish a JSDoc policy: document the WHY, not the WHAT. TypeScript types tell you what; JSDoc should tell you why, when, gotchas, and examples.
- NEVER restate parameter types in JSDoc. Omit `@param` entirely when the parameter name and TypeScript type are self-documenting. Use `@param` only to explain non-obvious behavior (e.g., `@param tenantId - Must be the org ID from better-auth, not the slug`).
- DO document: (1) `@example` blocks for non-obvious usage, (2) `@remarks` for architectural reasoning, (3) `@throws` or error conditions for functions returning `Result<T>`, (4) `@see` references to related functions or docs.
- The codebase already has good JSDoc on `ScopedDb` (explaining the tenant isolation contract) and sparse JSDoc on `CqrsBus`. The ScopedDb style is the target -- it explains behavior that types cannot express.
- Use `@internal` for functions that exist for module wiring but should not be called directly.

**Warning signs:**
JSDoc blocks longer than the function body. `@param` lines that are just the parameter name rephrased. `@returns` that says "Returns the result" on a function returning `Result<T>`. PR reviews where nobody reads the JSDoc.

**Phase to address:**
JSDoc phase (first). Define the JSDoc style guide with concrete examples of good vs bad before any annotation work begins.

---

### Pitfall 2: Tests That Test Implementation, Not Behavior

**What goes wrong:**
Unit tests verify internal implementation details -- method call order, private state, exact mock call arguments -- instead of observable behavior. When refactoring (which is the whole point of having tests), tests break even though behavior is unchanged. The test suite becomes a refactoring tax, not a refactoring safety net.

**Why it happens:**
The existing codebase has tightly coupled components (CQRS handlers that call `scopedDb`, emit events, enqueue jobs). The "obvious" way to test a command handler is to mock `scopedDb`, mock `emit`, mock `enqueue`, then assert each mock was called with exact arguments. This tests the implementation wiring, not the business behavior.

**How to avoid:**
- Test behavior through the Result: command handlers return `Result<T>`. Assert on `result.success`, `result.data`, and `result.error` -- these ARE the behavior contract. A handler that returns `{ success: true, data: { id: "123" } }` is correct regardless of whether it used `scopedDb.insert` or `scopedDb.raw`.
- For command handlers: provide input + mock context, assert Result output. Do NOT assert what methods were called on the context unless the side effect IS the behavior (e.g., "this command must emit a domain event" -- then assert `emit` was called with the event name, but not the exact payload shape unless it is part of the contract).
- For the CQRS bus: the existing tests in `cqrs.test.ts` are good examples -- they test dispatch behavior (registered handler executes, unregistered returns error), not internal Map operations.
- For `scopedDb`: test that tenant isolation actually works (insert with tenant A, query with tenant B returns nothing), not that `eq(table.tenantId, tenantId)` was called.
- Mock at module boundaries, not at function level. Mock the database connection, not individual Drizzle methods.

**Warning signs:**
Tests that break when you rename a private method. Tests that assert `mock.toHaveBeenCalledWith(exact, args, here)` for every line of the function. Tests where the setup (mocks) is 3x longer than the assertion. Tests that pass but do not catch real bugs when you intentionally break the function.

**Phase to address:**
Unit tests phase. Establish the "test behavior not implementation" rule with examples from existing `cqrs.test.ts` before writing new tests.

---

### Pitfall 3: Two Test Runners, Confused Boundaries

**What goes wrong:**
`bun test` and Vitest both exist in the monorepo but their boundaries blur. Backend tests accidentally use Vitest patterns (or import from `vitest`), UI tests use `bun:test`. Test configuration diverges -- one runner has coverage enabled, the other does not. CI runs both but counts coverage separately, making total coverage opaque. Developers do not know which runner to use for a new test file.

**Why it happens:**
The split exists for valid reasons: `bun test` for backend (fast, native, no config) and Vitest for React component tests (needs jsdom/happy-dom, React Testing Library). But when adding tests to `packages/shared`, `packages/config`, `packages/db`, or `packages/modules/*`, the choice is ambiguous -- these are backend packages but are pure TypeScript with no React.

**How to avoid:**
- Clear rule: `bun test` for everything EXCEPT files that need a DOM environment (React components). This means:
  - `apps/api/`, `packages/shared/`, `packages/config/`, `packages/db/`, `packages/queue/`, `packages/modules/*` --> `bun test`
  - `packages/ui/`, `apps/admin/` (if component tests added), `apps/web/` (if component tests added) --> Vitest
- The existing split already follows this -- `packages/ui/vitest.config.ts` exists only for UI. Preserve this.
- Add a root-level script: `"test": "bun test && cd packages/ui && bunx vitest run"` so CI runs both with one command.
- NEVER import from `vitest` in a `bun:test` file or vice versa. If a test file has `import { describe } from "bun:test"`, it runs with bun. Period.
- Coverage: configure both runners to output to the same format (lcov) in separate files, then merge for a combined report if total coverage is needed.

**Warning signs:**
A test file in `packages/modules/billing/` importing from `vitest`. A Vitest config appearing in a non-UI package. CI reporting two different coverage numbers with no combined view. Developers asking "which test runner do I use?" repeatedly.

**Phase to address:**
Unit tests phase (first task). Document the boundary rule and add a test runner decision table to the developer docs.

---

### Pitfall 4: Documentation That Goes Stale Immediately

**What goes wrong:**
Developer documentation describes the current system accurately. Two weeks later, a new module is added, an env variable is renamed, or a configuration option changes. The docs are now wrong. Nobody updates them because: (1) there is no process requiring it, (2) the docs are in a separate `/docs` folder disconnected from the code, (3) the person making the change did not write the docs and does not know they exist.

**Why it happens:**
Documentation and code are maintained separately with no coupling mechanism. Traditional docs in markdown files have zero connection to the source code they describe. There is no CI check that docs are current. The "documentation phase" creates a batch of docs that are correct at creation time but have no maintenance strategy.

**How to avoid:**
- Prefer JSDoc on the code itself over separate documentation files. A configuration guide in `packages/config/src/env.ts` as JSDoc on the schema definition stays coupled to the code -- when the env var changes, the developer is staring at the JSDoc.
- For docs that MUST be separate (getting started, architecture overview, testing guide): keep them minimal and reference code rather than duplicating it. Instead of "The env variables are: PORT, DATABASE_URL, ..." write "See `packages/config/src/env.ts` for all environment variables and their validation rules."
- Use code references that break visibly when the code changes: `` `packages/config/src/env.ts#L15-L30` `` in docs. If those lines move, at least the reference is clearly wrong.
- Add a `docs` section to the PR template checklist: "If this PR changes configuration, routes, or public APIs, update the corresponding doc."
- Do NOT document internal implementation details in separate docs. Those belong in JSDoc comments adjacent to the code.

**Warning signs:**
A docs folder with files that have not been modified in 3+ months while the code changed weekly. Documentation describing env variables that no longer exist. A "getting started" guide that does not work when followed step by step. Developers saying "ignore the docs, just read the code."

**Phase to address:**
Documentation phase. Define the documentation strategy (what goes in JSDoc vs separate docs) BEFORE writing any standalone documentation.

---

### Pitfall 5: Over-Documenting Trivial Code, Under-Documenting Complex Code

**What goes wrong:**
Simple utility functions (`cn()`, `ok()`, `err()`) get extensive JSDoc while the complex parts -- module registry loading order, tenant context propagation through CQRS, webhook normalization pipeline, better-auth callback wiring -- have no documentation. The coverage metric looks good (80% of exports documented) but the documentation is concentrated on the wrong 80%.

**Why it happens:**
Trivial code is easy to document. Complex code is hard to explain. When approaching JSDoc as a task to complete (rather than a communication to make), developers naturally start with the easy wins. By the time they reach the complex parts, momentum is spent.

**How to avoid:**
- Prioritize documentation by complexity, not by file order or alphabetical order.
- High-priority targets in this codebase (complex, non-obvious behavior):
  1. `packages/db/src/helpers/scoped-db.ts` -- tenant isolation contract (already has good JSDoc -- use as template)
  2. `apps/api/src/core/registry.ts` -- module loading, route registration, CQRS wiring
  3. `apps/api/src/core/middleware/tenant.ts` -- how tenant context is extracted and propagated
  4. `packages/modules/billing/` -- payment provider abstraction, webhook normalization
  5. `packages/modules/auth/` -- better-auth integration points, invitation lifecycle
  6. `packages/config/src/env.ts` -- environment validation, what each variable controls
- Low-priority targets (self-explanatory with types):
  1. `packages/shared/src/result.ts` -- `ok()` and `err()` are obvious from types
  2. `packages/ui/src/components/` -- shadcn components are well-documented upstream
  3. Simple re-export files (`index.ts` barrel exports)
- Start each phase by listing the files ranked by "how confused would a new developer be reading this?" and work top-down.

**Warning signs:**
More JSDoc on `ok<T>(data: T): Result<T>` than on `scopedDb()`. No JSDoc on any file in `packages/modules/`. The team's most senior developer being the only one who understands the registry wiring.

**Phase to address:**
JSDoc phase. Create the priority list before writing any documentation.

---

### Pitfall 6: Mock-Heavy Tests That Verify Nothing

**What goes wrong:**
Tests for CQRS command handlers mock the database, mock the event bus, mock the queue, mock the payment provider -- then assert the function ran without throwing. The test provides zero confidence because every external interaction is mocked away. The test passes whether the handler inserts data correctly or not, because the mock always succeeds.

**Why it happens:**
The Baseworks architecture has handlers that depend on `HandlerContext` with `db`, `emit`, and `enqueue`. Mocking all of these is necessary to isolate the handler, but when every dependency is mocked to succeed, the handler's logic is the only thing being tested -- and often the logic IS the dependency calls.

**How to avoid:**
- For command/query handlers: use a lightweight integration approach. Create a real `scopedDb` backed by an in-memory or test database (PGlite or a test PostgreSQL instance) rather than mocking individual Drizzle methods. This tests the actual SQL behavior.
- If full DB setup is too heavy for unit tests, at minimum:
  - Mock `scopedDb` at the interface level (provide `select`, `insert`, `update`, `delete` that return realistic data), NOT at the Drizzle level.
  - Assert on the Result output, not on mock call counts.
  - Test error paths: what happens when `insert` throws? When the record is not found? When tenant isolation rejects? These are the valuable tests.
- For event emission: assert the event name and key payload fields, not the entire payload shape. The contract is "a `billing.payment.succeeded` event is emitted with `tenantId` and `amount`", not the full 15-field event object.
- For the queue: assert the job name and that it was enqueued. The job processor has its own tests.
- Aim for: 70% of tests assert on Result output, 20% test error/edge cases, 10% verify critical side effects.

**Warning signs:**
A test file where `mock()` calls outnumber `expect()` calls. Tests that pass with an empty handler function (because all behavior is mocked). Tests where removing the handler's database call does not fail any test. Code coverage says 90% but real bugs are found in production.

**Phase to address:**
Unit tests phase. Define the mocking strategy with a concrete example test before writing tests at scale.

---

### Pitfall 7: Biome + JSDoc Formatting Conflicts

**What goes wrong:**
Biome reformats JSDoc comments in unexpected ways -- breaking multi-line `@example` blocks, collapsing intentional line breaks, or wrapping long `@see` URLs at the 100-character line width limit. Developers add JSDoc, run `biome format`, and the JSDoc becomes unreadable. Alternatively, developers fight the formatter by adding `// biome-ignore` comments throughout, creating a messy codebase.

**Why it happens:**
Biome 2.0 (the version in `biome.json` based on the schema URL) formats JavaScript/TypeScript code including comments. The `lineWidth: 100` setting applies to JSDoc comments, which can make `@example` code blocks wrap at awkward points. Long URLs in `@see` tags get split across lines.

**How to avoid:**
- Test Biome formatting on a sample JSDoc block BEFORE committing to a JSDoc style. Write 5-6 representative JSDoc comments (with `@example`, `@see`, `@remarks`), run `biome format`, and verify the output is acceptable.
- Keep `@example` blocks short (under 80 chars per line to avoid wrapping at 100).
- For long URLs, use short descriptions: `@see {@link scopedDb} for tenant-scoped operations` instead of full file paths.
- If Biome mangles multi-line JSDoc, consider whether the JSDoc is too verbose rather than fighting the formatter.
- Do NOT disable Biome formatting for entire files to preserve JSDoc layout. If specific comments need protection, this is a sign the JSDoc is too complex.

**Warning signs:**
JSDoc `@example` blocks that render incorrectly after formatting. Developers adding `// biome-ignore format:` above JSDoc blocks. Inconsistent JSDoc style between files (some formatted by Biome, some not).

**Phase to address:**
JSDoc phase (first task). Validate Biome compatibility before establishing the JSDoc style guide.

---

### Pitfall 8: Testing shadcn/ui Components That Are Already Tested Upstream

**What goes wrong:**
The team writes unit tests for `Button`, `Dialog`, `Input`, `Select`, and other shadcn components verifying that they render, accept props, and handle clicks. These components are copy-pasted from shadcn (a well-tested library backed by Radix UI). The tests add maintenance cost but verify behavior that is already guaranteed by the upstream library. Meanwhile, the application-specific compositions (invite dialog, billing page, tenant switcher) that contain real business logic go untested.

**Why it happens:**
Coverage metrics count `packages/ui/src/components/*.tsx` as uncovered. The natural response is to write tests for those files. But shadcn components are thin wrappers around Radix primitives -- testing them is testing Radix, not your application.

**How to avoid:**
- Do NOT unit test individual shadcn base components (`button.tsx`, `dialog.tsx`, `input.tsx`, `select.tsx`, etc.) unless you have modified their behavior beyond the shadcn default.
- DO test: (1) composed components that combine multiple shadcn primitives with business logic (e.g., `InviteDialog`, `TenantSwitcher`, `DataTable` with custom columns), (2) accessibility of composed components (the existing `*.a11y.test.tsx` files are correct -- they test a11y contracts, not rendering), (3) custom hooks that wire shadcn components to application state.
- The existing a11y tests (`button.a11y.test.tsx`, `dialog.a11y.test.tsx`) are a good model -- they verify accessibility contracts, not component rendering.
- If coverage metrics flag uncovered shadcn base components, exclude `packages/ui/src/components/ui/` from coverage requirements (or set a lower threshold for that directory).

**Warning signs:**
Tests that verify `<Button>` renders a `<button>` element. Tests that verify `<Dialog>` opens when triggered. Coverage configuration that forces 80% on unchanged shadcn components. More test files for base components than for application components.

**Phase to address:**
Unit tests phase. Define what is in scope for testing (application compositions) vs out of scope (shadcn base components) before writing tests.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Adding `@ts-ignore` in test files to bypass complex mock typing | Tests compile without type gymnastics | Type errors in tests hide real issues; mocks drift from actual interfaces | Never -- use `as unknown as ScopedDb` casting or proper mock types |
| Writing JSDoc only for public API (exported functions) | Less documentation work | Internal functions with complex logic (like module registration internals) remain undocumented for contributors | Acceptable for v1.2 MVP -- document exports first, internals in a follow-up |
| Skipping tests for error paths ("happy path first") | Faster test writing, coverage goes up quickly | Error handling is where most bugs live in production; untested error paths give false confidence | Never for CQRS handlers where Result<T> error cases are the primary contract |
| Using snapshot tests for complex object assertions | Quick to write, catches any change | Snapshots break on every refactor, developers `--update` without reviewing, mask intentional changes | Only for React component render output where visual regression matters |
| Documentation in a wiki/Notion instead of in-repo | Easier to write with rich formatting | Goes stale instantly, not versioned with code, not discoverable by developers in their editor | Never for technical docs -- use in-repo markdown with JSDoc |
| Single massive test file per module | All tests in one place | File becomes 500+ lines, slow to run, hard to find specific test, discourages adding new tests | Never -- split by feature/behavior within the module |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Biome + JSDoc `@example` | `@example` code blocks get reformatted by Biome, breaking indentation and sometimes syntax | Keep examples under 80 chars wide. Test format output. Consider using `@remarks` with inline code fences instead of `@example` if Biome mangles them. |
| `bun test` + `mock.module()` | Mocking workspace packages (`@baseworks/config`) with `mock.module()` requires the mock to be declared before any import that transitively loads the real module | Always put `mock.module()` calls at the TOP of the test file, before any other imports. The existing `billing.test.ts` does this correctly -- use as a template. |
| `bun test` + TypeBox validation in handlers | `defineCommand`/`defineQuery` compile TypeBox schemas at import time. Tests that import handlers trigger schema compilation, which may fail if TypeBox is not properly resolved in the test environment | Ensure `@sinclair/typebox` is available in the test package's dependencies. Or test the raw handler function separately from the `defineCommand` wrapper. |
| Vitest + Tailwind 4 CSS | Component tests that assert on className presence break when Tailwind 4's CSS-first approach changes class generation | Never assert on specific Tailwind class names in tests. Assert on rendered behavior (visibility, accessibility, computed styles if needed). |
| JSDoc + `packages/api-client/` Eden Treaty types | Adding JSDoc to the Eden Treaty client is meaningless -- types are auto-inferred from Elysia routes. JSDoc on the treaty client will be wrong or redundant. | Document the Elysia route handlers (source of truth), NOT the Eden Treaty client (derived types). Document the treaty initialization in `apps/web/lib/api.ts` and `apps/admin/src/lib/api.ts` for setup context. |
| Developer docs + monorepo workspace paths | Documentation references like "run `bun test` in packages/modules/billing" break when workspace structure changes | Use workspace names in docs (`bun test --filter @baseworks/module-billing`) rather than file paths. Or document from root: `cd packages/modules/billing && bun test`. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Running full test suite on every file save in watch mode | Dev machine fans spin, 30+ second feedback loop, developers disable watch mode | Configure `bun test --watch` to only run tests related to changed files. Use `--bail` to stop on first failure during development. | At 100+ test files |
| Verbose JSDoc increasing bundle size (if included in declaration files) | `declaration: true` in tsconfig means JSDoc ends up in `.d.ts` files, increasing package size | JSDoc in declaration files is actually desirable for IDE support. Only a concern if shipping to npm (Baseworks is not). Not a real issue here. | N/A for internal monorepo |
| Test setup/teardown creating real database connections | Each test file opens a PostgreSQL connection, test suite takes minutes, CI times out | Use `mock.module("postgres", ...)` for unit tests (as existing tests do). Reserve real DB connections for dedicated integration test suites that run separately. | At 50+ test files each opening connections |
| Snapshot tests generating large `.snap` files in version control | Git diffs become unreadable, PR reviews skip snapshot changes, merge conflicts in snapshots | Avoid snapshot tests for data structures. Use explicit assertions. If snapshots needed, use inline snapshots (`toMatchInlineSnapshot`). | At 20+ snapshot files |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| JSDoc `@example` blocks containing real API keys, tokens, or connection strings | Secrets committed to version control in documentation | Use obviously fake values in examples: `sk_test_FAKE`, `postgres://user:pass@localhost/db`. Add a pre-commit grep check for patterns like `sk_live_`, `Bearer ey`, real connection strings. |
| Test fixtures with production-like data (real emails, real tenant IDs) | Data leaks if repo becomes public; GDPR concerns | Use obviously fake data: `test@example.com`, `tenant-test-123`. The existing tests use `"test-tenant"` -- maintain this pattern. |
| Developer docs describing internal security mechanisms in detail | Attackers learn about rate limiting thresholds, auth bypass paths, webhook verification details | Document security features at a high level ("webhooks are signature-verified"). Keep implementation details in code comments, not in discoverable docs. |

## UX Pitfalls

Not directly applicable to this milestone (documentation and quality are developer-facing). The "UX" here is Developer Experience (DX).

| Pitfall | Developer Impact | Better Approach |
|---------|-----------------|-----------------|
| JSDoc that requires scrolling past 20 lines to see the function signature | Developer must scroll past documentation to understand the function, defeating the purpose | Keep JSDoc concise. Use `@see` to link to detailed docs rather than embedding essays in JSDoc. If a JSDoc block exceeds 10 lines, consider whether a separate doc page is more appropriate. |
| Test file organization that does not match source file organization | Developer cannot find tests for a specific module. Tests for `registry.ts` are in a `__tests__/` folder three directories up. | Mirror source structure: `src/core/registry.ts` -> `src/core/__tests__/registry.test.ts`. The existing codebase already follows this pattern -- maintain it. |
| Developer docs that assume knowledge of the architecture | New contributor reads "configure the module registry" but does not know what the module registry is or where it lives | Every doc page starts with a one-paragraph context: what this component is, where it lives, why it exists. Then the how-to. |
| No table of contents or entry point for documentation | Developer knows docs exist but cannot find the relevant one | Create a single `docs/README.md` that links to all other docs with one-line descriptions. This is the only doc index needed. |

## "Looks Done But Isn't" Checklist

- [ ] **JSDoc:** Complex functions documented (registry, scoped-db, middleware, billing) -- verify by reading JSDoc on the 10 most complex files without looking at the code. Can you understand what each function does, when to use it, and what can go wrong?
- [ ] **JSDoc:** No type duplication -- verify by searching for `@param {string}` or `@param {number}` patterns. In TypeScript, JSDoc should NOT include type annotations (they shadow TS types and can diverge).
- [ ] **JSDoc:** `@example` blocks actually compile -- verify by copying each `@example` into a scratch file and checking it compiles with `tsc --noEmit`.
- [ ] **Tests:** Error paths tested -- verify by checking that every command/query handler has at least one test for `result.success === false`.
- [ ] **Tests:** Tests fail when behavior breaks -- verify by intentionally breaking a handler (change a return value) and confirming the test catches it. If tests still pass, they are testing mocks, not behavior.
- [ ] **Tests:** No `bun:test` imports in UI test files, no `vitest` imports in backend test files -- verify with grep.
- [ ] **Tests:** Test files colocated with source -- verify every `__tests__` directory is adjacent to the source files it tests.
- [ ] **Docs:** Getting started guide works from scratch -- verify by following it on a clean clone (delete node_modules, .env, docker volumes).
- [ ] **Docs:** Configuration docs reference actual env vars -- verify by comparing documented vars against `packages/config/src/env.ts`.
- [ ] **Docs:** No dead links -- verify internal references point to files that exist.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| JSDoc duplicating types | LOW | Search and remove `@param {type}` patterns. Replace verbose JSDoc with concise explanations. 1-2 hours for full codebase. |
| Tests testing implementation | MEDIUM | Rewrite tests to assert on Result output instead of mock calls. Requires understanding each handler's behavior contract. 1-2 days. |
| Test runner confusion | LOW | Add linting rule or grep check in CI: fail if `vitest` appears in non-UI packages. 30 minutes. |
| Stale documentation | LOW | Add doc-check to PR template. Delete docs that are already stale. Link to code instead of duplicating it. 1-2 hours. |
| Over-documented trivial code | LOW | Delete obvious JSDoc (on `ok()`, `err()`, simple re-exports). Redirect effort to complex functions. 1 hour. |
| Mock-heavy tests | MEDIUM | Identify tests with 5+ mocks and zero behavior assertions. Rewrite with Result-based assertions. 2-3 days. |
| Biome + JSDoc conflicts | LOW | Run Biome format on all files, review JSDoc output, adjust style guide. 1-2 hours. |
| Testing shadcn base components | LOW | Delete unnecessary base component tests. Keep a11y tests. Redirect effort to application compositions. 1 hour. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| JSDoc duplicating types | JSDoc phase (define style guide first) | Grep for `@param {` in JSDoc -- should find zero matches in TypeScript files |
| Tests testing implementation | Unit tests phase (define mocking strategy first) | Review 10 random tests: >70% should assert on Result output or rendered output, not mock calls |
| Two test runners confused | Unit tests phase (first task: document boundary) | `grep -r "from 'vitest'" packages/modules/ packages/shared/ packages/db/ packages/config/ packages/queue/ apps/api/` returns zero |
| Documentation going stale | Documentation phase (strategy before writing) | PR template includes "docs updated?" checkbox. Docs reference code locations, not copied content. |
| Over-documenting trivial code | JSDoc phase (priority list first) | Files in `packages/modules/*/` have more JSDoc than files in `packages/shared/src/result.ts` |
| Mock-heavy tests | Unit tests phase (example test first) | No test file has more `mock()` calls than `expect()` calls |
| Biome + JSDoc formatting | JSDoc phase (first task) | `biome format --write` produces no changes after JSDoc is written (already formatted) |
| Testing shadcn base components | Unit tests phase (scope definition) | No test file exists for unmodified shadcn base components (button, dialog, input, etc.) unless it is an a11y test |
| Stale documentation | Documentation phase (maintenance strategy) | Every doc file modified within last 30 days of active development |

## Recommended Phase Ordering Based on Pitfalls

Based on pitfall dependencies:

1. **JSDoc annotations** first -- because (a) writing tests requires understanding the code, which JSDoc forces you to articulate, (b) JSDoc serves as the specification that tests verify, (c) Biome compatibility must be validated before committing to a style
2. **Unit tests** second -- because (a) JSDoc documents the behavior contract that tests verify, (b) the testing boundary (bun test vs Vitest) must be established before any test writing, (c) tests validate that JSDoc claims are accurate
3. **Developer documentation** third -- because (a) JSDoc already covers API-level docs, so separate docs can focus on architecture/guides/getting-started, (b) writing tests exposes the real gotchas and setup steps that belong in docs, (c) docs can reference the now-documented code rather than duplicating it

## Sources

- Existing codebase analysis: `apps/api/src/core/__tests__/cqrs.test.ts` (good behavioral test example), `packages/db/src/helpers/scoped-db.ts` (good JSDoc example), `packages/modules/billing/src/__tests__/billing.test.ts` (mock.module pattern reference)
- Biome 2.0 schema in `biome.json` (formatting configuration: lineWidth 100, indentWidth 2)
- TypeScript handbook JSDoc reference: https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html
- Bun test documentation: https://bun.sh/docs/cli/test
- Existing test runner split: `bun:test` for backend, Vitest only in `packages/ui/vitest.config.ts`
- TSConfig `declaration: true` in root `tsconfig.json` means JSDoc propagates to .d.ts files

---
*Pitfalls research for: Baseworks v1.2 Documentation & Quality*
*Researched: 2026-04-16*
