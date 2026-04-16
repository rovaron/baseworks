# Phase 13: JSDoc Annotations - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Add standardized JSDoc annotations to every exported function, type, and handler across the codebase. Documents intent and contracts -- not restating TypeScript signatures. Covers packages/shared, packages/db, module ports, CQRS handlers, and core infrastructure. A style guide must be established before volume work begins.

</domain>

<decisions>
## Implementation Decisions

### JSDoc Depth & Tone
- **D-01:** Comprehensive documentation -- full JSDoc blocks with purpose, all params with descriptions, return type semantics, throws, side effects. Similar in thoroughness to the existing `create-invitation.ts` 14-line block pattern.
- **D-02:** Technical-precise tone -- formal, direct, reference-style documentation. "Validates tenant ownership and emits TenantDeleted event." Reads like API docs, not a tutorial.
- **D-03:** Always include @param and @returns tags even when TypeScript signatures already express the types. Ensures IDE tooltips always show full documentation regardless of editor capabilities.
- **D-04:** Rewrite all existing JSDoc that doesn't match the new standard. Normalize everything codebase-wide for consistency, even if it touches more files.

### @example Strategy
- **D-05:** Mix of public API entry points and complex/non-obvious functions for @example blocks (10-15 total). Target: 5-7 public API entry points (defineCommand, defineQuery, registerModule, CqrsBus execute/query, EventBus emit/on, db helpers) + 5-7 complex functions (Result type usage, HandlerContext patterns, middleware chaining, multi-step flows).
- **D-06:** Minimal runnable snippets -- 3-5 lines showing the most common usage. Enough to copy-paste and adapt, no setup boilerplate.

### Claude's Discretion
- Style guide format and location (dedicated .md file, sections, structure)
- Handler doc template specifics (exact tag ordering, which tags for defineCommand/defineQuery factory pattern)
- Biome compatibility validation approach
- Ordering of work across packages (which package first)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs -- requirements fully captured in decisions above and REQUIREMENTS.md (JSDOC-01 through JSDOC-06).

### Existing patterns
- `packages/modules/auth/src/commands/create-invitation.ts` -- Reference for comprehensive JSDoc block style (14-line block, current best example in codebase)
- `apps/api/src/core/registry.ts` -- ModuleRegistry already has detailed JSDoc; reference for infrastructure documentation style
- `apps/api/src/core/event-bus.ts` -- TypedEventBus already has JSDoc; reference for core method documentation
- `biome.json` -- Linter/formatter config; JSDoc must be compatible with configured rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `create-invitation.ts` JSDoc block: Can serve as the gold standard for handler documentation
- `registry.ts` JSDoc: Reference for infrastructure method documentation
- `defineCommand`/`defineQuery` factories in `packages/shared`: All handlers use these; JSDoc template must account for the factory pattern

### Established Patterns
- All CQRS handlers use `defineCommand`/`defineQuery` wrappers with schema validation
- ~21% of codebase already has some JSDoc (inconsistent quality)
- `packages/shared/src/types/` contains 4 core type files (cqrs.ts, context.ts, module.ts, events.ts)

### Integration Points
- ~80 exported items across packages/shared (6 files), packages/db (11 files), modules (55 files), and core (6 files)
- Auth module: 8 commands + 6 queries + routes/middleware
- Billing module: 6 commands + 2 queries + adapters
- Example module: scaffolding module

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 13-jsdoc-annotations*
*Context gathered: 2026-04-16*
