# Stack Research: v1.2 Documentation & Quality

**Domain:** JSDoc annotations, test coverage, developer documentation for TypeScript monorepo
**Researched:** 2026-04-16
**Confidence:** HIGH

**Scope:** This document covers ONLY new stack additions for v1.2 Documentation & Quality. The existing stack (Bun, Elysia, Drizzle, Next.js 15, Vite, React 19, shadcn/ui, Tailwind 4, better-auth, Stripe, Pagar.me, BullMQ, pino, Biome, bun test, Vitest, etc.) is validated and unchanged.

---

## New Stack Additions

### 1. JSDoc / TSDoc Annotation Tooling

**Strategy:** Use standard JSDoc syntax (not TSDoc-specific tags) because TypeDoc, TypeScript, and all major editors support JSDoc natively. Since this is a TypeScript codebase, omit type annotations from JSDoc comments -- TypeScript's type system provides that. Focus JSDoc on `@param` descriptions, `@returns` descriptions, `@throws`, `@example`, and module/function purpose documentation.

**Why JSDoc over TSDoc syntax:**
- TypeDoc supports both JSDoc and TSDoc tags, with JSDoc being the more widely understood format
- TypeScript's own compiler understands JSDoc comments and surfaces them in hover tooltips
- TSDoc's stricter spec adds marginal value when you already have TypeScript types -- the descriptions are the same
- No need for `eslint-plugin-tsdoc` dependency; JSDoc is the pragmatic choice

**No JSDoc linting tool needed.** Biome does not yet support JSDoc validation rules (as of 2026). Adding `eslint-plugin-jsdoc` would require reintroducing ESLint alongside Biome, creating a dual-linter setup. This is not worth the complexity. Instead, enforce JSDoc quality through:
- Code review conventions (documented in the developer guide)
- TypeDoc build step that will surface broken references and missing exports
- TypeScript's own `@param` tooltip rendering as visual feedback during development

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| (none)     | --      | JSDoc authoring | No tooling additions needed. Use standard JSDoc in `.ts` files. TypeScript + editor IntelliSense handles display. |

---

### 2. Documentation Generation

**Strategy:** Use TypeDoc to generate API reference documentation from JSDoc comments and TypeScript type signatures. TypeDoc is the only mature, actively maintained documentation generator for TypeScript. Configure it in monorepo "packages" mode to produce unified docs across all workspace packages.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| typedoc | ^0.28 | API docs from TSDoc/JSDoc + types | The standard TypeScript documentation generator. Reads JSDoc comments + TS type signatures. Outputs HTML or JSON. Supports monorepo workspaces via `entryPointStrategy: "packages"`. Actively maintained, TS 5.0-5.8+ compatible. |
| typedoc-plugin-markdown | ^4.0 | Markdown output | Generates Markdown instead of HTML. Better for in-repo docs that live alongside code. Can be committed to `docs/api/` and read on GitHub directly. |

**Monorepo configuration (typedoc.json at root):**
```json
{
  "entryPointStrategy": "packages",
  "entryPoints": [
    "packages/shared",
    "packages/db",
    "packages/config",
    "packages/queue",
    "packages/ui",
    "packages/api-client",
    "packages/modules/auth",
    "packages/modules/billing"
  ],
  "out": "docs/api",
  "packageOptions": {
    "entryPoints": ["src/index.ts"]
  },
  "plugin": ["typedoc-plugin-markdown"],
  "excludePrivate": true,
  "excludeInternal": true
}
```

**What NOT to use for docs:**
- **Docusaurus / VitePress / Nextra** -- Full static site generators are overkill for in-repo developer documentation. The milestone scope is "in-repo docs," not a documentation website. Plain Markdown files in `docs/` plus TypeDoc-generated API reference is sufficient.
- **Storybook** -- Out of scope for this milestone. Would be valuable for UI component documentation but adds significant build infrastructure.
- **api-extractor (@microsoft/api-extractor)** -- Designed for published npm packages with .d.ts rollup. Baseworks is a monorepo starter kit, not a published library. Unnecessary complexity.

---

### 3. Test Coverage Reporting

**Strategy:** Use Bun's built-in coverage reporter for backend tests and Vitest's v8 coverage provider for frontend/UI tests. Both output LCOV format for unified reporting.

#### Backend Coverage (bun test)

Bun's test runner has native coverage support via `--coverage` flag. It supports `text` and `lcov` reporters, configurable through CLI flags or `bunfig.toml`.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| (bun built-in) | -- | Backend test coverage | `bun test --coverage --coverage-reporter=lcov` outputs lcov.info. Zero dependencies. Already part of the runtime. |

**bunfig.toml configuration:**
```toml
[test]
coverage = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
```

#### Frontend Coverage (Vitest)

Vitest supports v8 and istanbul coverage providers. Use v8 -- it is faster (10% overhead vs 300% for istanbul) and since Vitest 3.2.0 uses AST-based remapping that produces accuracy identical to istanbul.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @vitest/coverage-v8 | ^4.0 | UI component test coverage | v8 provider for Vitest. Fastest option. AST-based remapping since v3.2.0 gives istanbul-equivalent accuracy. Zero-config with Vitest. |

**Vitest config addition (packages/ui/vitest.config.ts):**
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts']
    }
  }
})
```

**What NOT to use:**
- **istanbul / @vitest/coverage-istanbul** -- v8 is faster and now equally accurate. Istanbul adds 300% overhead.
- **nyc** -- Legacy CLI wrapper for istanbul. Replaced by native coverage in modern test runners.
- **c8** -- Standalone v8 coverage CLI. Redundant when both bun test and Vitest have built-in v8 coverage.
- **codecov / coveralls** -- Cloud coverage tracking services. Not needed for an in-repo starter kit. If CI reporting is wanted later, the LCOV output is compatible.

---

### 4. Testing Utilities for Existing Stack

#### Database Testing with PGlite

**Strategy:** Use `@electric-sql/pglite` for database-dependent unit tests. PGlite is a WASM build of PostgreSQL that runs entirely in-process -- no Docker, no external database, instant startup. Combined with Drizzle ORM, it provides real PostgreSQL semantics in tests.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @electric-sql/pglite | ^0.4 | In-memory PostgreSQL for tests | WASM PostgreSQL -- real Postgres semantics without Docker. 3MB gzipped. Instant startup. Native Drizzle integration via `drizzle-orm/pglite`. Ideal for testing tenant-scoped queries, CQRS handlers, and migration correctness. |

**Test helper pattern:**
```typescript
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@baseworks/db/schema';

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  // Run migrations or push schema
  return { db, client };
}
```

**Why PGlite over alternatives:**
- **SQLite (better-sqlite3)**: Different SQL dialect. Baseworks uses PostgreSQL-specific features (JSONB, gen_random_uuid()). Testing with SQLite would miss real bugs.
- **Testcontainers**: Requires Docker. Slower startup (~2-5s per container). PGlite starts in ~50ms.
- **Mocking Drizzle directly**: Fragile. Mocks drift from real behavior. PGlite gives real PostgreSQL execution.

#### BullMQ Testing

**Strategy:** Test job processors in isolation by extracting processor functions and testing them with mocked dependencies. For queue integration, use `ioredis-mock` to avoid requiring Redis in the test environment.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| ioredis-mock | ^8.0 | Mock Redis for BullMQ tests | In-memory Redis mock compatible with ioredis API. Avoids requiring real Redis for unit tests. Use for testing queue add/processing logic without infrastructure. |

**Testing pattern for BullMQ:**
```typescript
// Extract processor logic into pure functions
export async function processEmailJob(data: EmailJobData, deps: { resend: ResendClient }) {
  // Business logic here -- testable without BullMQ
}

// Test the processor directly
it('sends email with correct template', async () => {
  const mockResend = { emails: { send: mock(() => ({ id: 'test' })) } };
  await processEmailJob({ to: 'a@b.com', template: 'welcome' }, { resend: mockResend });
  expect(mockResend.emails.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.com' }));
});
```

#### Elysia Testing

**No new libraries needed.** Elysia provides built-in testing via `app.handle()` which accepts Web Standard Request objects and returns Response. Eden Treaty can also be passed an Elysia instance directly for type-safe testing without network requests. Both approaches work with `bun test` out of the box.

#### better-auth Testing

**No new libraries needed.** better-auth handlers are testable through the Elysia app's `handle()` method. Mock the database layer (via PGlite) and test auth flows as HTTP request/response cycles.

---

## Installation (v1.2 additions only)

```bash
# Documentation generation (root dev dependency)
bun add -D typedoc typedoc-plugin-markdown

# Frontend test coverage (packages/ui)
cd packages/ui && bun add -D @vitest/coverage-v8

# Database testing (root dev dependency -- used across packages)
bun add -D @electric-sql/pglite

# BullMQ testing (root dev dependency)
bun add -D ioredis-mock
```

**Backend coverage (bun test) requires no installation** -- built into Bun runtime.

---

## Root package.json Script Additions

```json
{
  "scripts": {
    "test": "bun test",
    "test:coverage": "bun test --coverage --coverage-reporter=lcov",
    "test:ui": "cd packages/ui && bun vitest run",
    "test:ui:coverage": "cd packages/ui && bun vitest run --coverage",
    "docs:api": "typedoc"
  }
}
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Doc generator | TypeDoc | api-extractor | api-extractor is for published npm packages with .d.ts rollup. Baseworks is a monorepo, not a library. |
| Doc generator | TypeDoc | Docusaurus/VitePress | Full static site generators. Overkill for in-repo docs. Adds build complexity. |
| Doc output | typedoc-plugin-markdown | TypeDoc HTML | Markdown is readable on GitHub, diffable in PRs, and lives in-repo. HTML requires hosting. |
| JSDoc linting | None (conventions) | eslint-plugin-jsdoc | Would require reintroducing ESLint alongside Biome. Dual-linter complexity not worth it. |
| Comment standard | JSDoc | TSDoc | JSDoc is universally supported. TSDoc adds marginal value in a TypeScript project where types are already explicit. |
| Backend coverage | Bun built-in | c8 / nyc | Redundant. Bun has native v8 coverage with LCOV output. |
| Frontend coverage | @vitest/coverage-v8 | @vitest/coverage-istanbul | v8 is 30x faster. Since Vitest 3.2.0, accuracy is equivalent to istanbul via AST remapping. |
| DB testing | PGlite | Testcontainers | Docker required, 2-5s startup. PGlite is in-process WASM Postgres, ~50ms startup. |
| DB testing | PGlite | SQLite (better-sqlite3) | Different SQL dialect. Would miss PostgreSQL-specific bugs (JSONB, UUID, etc.). |
| DB testing | PGlite | Mocking Drizzle | Fragile mocks that drift from real DB behavior. PGlite executes real SQL. |
| Redis mocking | ioredis-mock | Testcontainers Redis | Simpler for unit tests. No Docker needed. Real Redis only needed for integration tests. |
| Component docs | None (defer) | Storybook | Significant infrastructure. Out of scope for v1.2. Worth considering in a future milestone. |

---

## What NOT to Add for v1.2

| Technology | Why Not | Use Instead |
|------------|---------|-------------|
| eslint-plugin-jsdoc | Reintroduces ESLint alongside Biome; dual-linter complexity | Code review conventions + TypeDoc build validation |
| eslint-plugin-tsdoc | Same ESLint problem. TSDoc standard adds marginal value over JSDoc | Standard JSDoc syntax |
| Docusaurus / VitePress / Nextra | Overkill for in-repo docs. Adds build pipeline, hosting requirement | Markdown files in `docs/` + TypeDoc-generated API reference |
| Storybook | Major infrastructure addition. Not in milestone scope | Defer to future milestone |
| @vitest/coverage-istanbul | 30x slower than v8. No accuracy advantage since Vitest 3.2.0 | @vitest/coverage-v8 |
| nyc / c8 | Legacy coverage CLIs. Both Bun and Vitest have built-in coverage | Native coverage in test runners |
| codecov / coveralls | Cloud services. Not needed for a starter kit | Local LCOV files. Add cloud reporting in CI if desired later |
| Testcontainers | Docker overhead for unit tests | PGlite for DB tests, ioredis-mock for Redis tests |
| better-sqlite3 | Wrong SQL dialect for PostgreSQL testing | PGlite (real PostgreSQL semantics) |
| api-extractor | Designed for published packages, not monorepo internal docs | TypeDoc |
| @snaplet/seed | Listed in original stack but adds complexity for seeding. Test data factories can be simple functions | Manual test factory helpers using PGlite |

---

## Version Compatibility (v1.2 additions)

| New Package | Compatible With | Notes |
|-------------|-----------------|-------|
| typedoc ^0.28 | TypeScript 5.0-5.8+ | Reads tsconfig.json directly. Monorepo mode via `entryPointStrategy: "packages"` |
| typedoc-plugin-markdown ^4.0 | typedoc ^0.28 | Must match typedoc major version |
| @vitest/coverage-v8 ^4.0 | Vitest ^4.0 | Must match Vitest version. Currently installed: Vitest 4.1.3 |
| @electric-sql/pglite ^0.4 | Bun 1.0+, drizzle-orm 0.36+ | Use `drizzle-orm/pglite` adapter. WASM-based, no native dependencies |
| ioredis-mock ^8.0 | ioredis 5.x, BullMQ 5.x | Drop-in replacement for ioredis in test context |

---

## Sources

- [TypeDoc official site](https://typedoc.org/) -- Version 0.28.17, TypeScript 5.0-5.8 support, monorepo packages mode
- [TypeDoc GitHub releases](https://github.com/TypeStrong/typedoc/releases) -- Latest version verification
- [TypeDoc input options](https://typedoc.org/documents/Options.Input.html) -- entryPointStrategy: "packages" for monorepos
- [Bun test coverage docs](https://bun.com/docs/test/coverage) -- Built-in --coverage flag, LCOV reporter
- [Vitest coverage guide](https://vitest.dev/guide/coverage) -- v8 vs istanbul, AST-based remapping since v3.2.0
- [Elysia unit testing docs](https://elysiajs.com/patterns/unit-test) -- app.handle() for HTTP testing without network
- [Eden Treaty unit testing](https://elysiajs.com/eden/treaty/unit-test) -- Pass Elysia instance directly to Eden
- [PGlite npm package](https://www.npmjs.com/package/@electric-sql/pglite) -- v0.4.4, WASM PostgreSQL for testing
- [Drizzle + PGlite integration](https://orm.drizzle.team/docs/connect-pglite) -- Official Drizzle adapter for PGlite
- [BullMQ unit testing guide](https://oneuptime.com/blog/post/2026-01-21-bullmq-unit-testing/view) -- Processor extraction pattern
- [Biome JSDoc discussion](https://github.com/biomejs/biome/discussions/741) -- JSDoc formatter/linting not yet implemented
- [Biome 2026 roadmap](https://biomejs.dev/blog/roadmap-2026/) -- JSDoc not on roadmap
- [eslint-plugin-jsdoc npm](https://www.npmjs.com/package/eslint-plugin-jsdoc) -- v62+, TypeScript recommended config available (but requires ESLint)
- [TypeScript JSDoc reference](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html) -- Supported JSDoc tags in TS

---
*Stack research for: Baseworks v1.2 Documentation & Quality*
*Researched: 2026-04-16*
