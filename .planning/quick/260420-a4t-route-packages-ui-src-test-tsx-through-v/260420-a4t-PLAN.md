---
phase: quick-260420-a4t
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/ui/package.json
  - bunfig.toml
  - package.json
autonomous: true
requirements:
  - QUICK-260420-A4T-01
must_haves:
  truths:
    - "Running `bun test` from repo root does NOT execute any file under packages/ui/src/**/*.test.tsx"
    - "Running `bun test` from repo root no longer reports the 22 UI a11y `ReferenceError: document is not defined` failures"
    - "Running `cd packages/ui && bun run test` executes the a11y tests under jsdom and they pass"
    - "Running `bun run test` from repo root runs both the bun test suite AND the vitest UI suite sequentially"
  artifacts:
    - path: "packages/ui/package.json"
      provides: "test script invoking vitest run"
      contains: '"test": "vitest run"'
    - path: "bunfig.toml"
      provides: "Bun test exclusion for packages/ui"
      contains: "[test]"
    - path: "package.json"
      provides: "root test orchestration script running both runners"
      contains: '"test":'
  key_links:
    - from: "bunfig.toml"
      to: "bun test discovery"
      via: "[test] section keys (root or testPathIgnorePatterns) that exclude packages/ui/src/**/*.test.tsx"
      pattern: "\\[test\\]"
    - from: "root package.json scripts.test"
      to: "packages/ui/package.json scripts.test"
      via: "bun test && (cd packages/ui && bun run test)"
      pattern: "cd packages/ui.*bun run test"
---

<objective>
Route React/jsdom UI tests through Vitest while keeping non-DOM tests on Bun's native runner.

Purpose: Eliminate 22 spurious `ReferenceError: document is not defined` failures caused by Bun trying to execute `@testing-library/react` tests that require a DOM. The vitest config (jsdom + setupFiles) is already correct — only the wiring is missing.

Output:
- `packages/ui/package.json` gains a `test` script invoking `vitest run`
- `bunfig.toml` gains a `[test]` section excluding `packages/ui` test files from Bun's discovery
- Root `package.json` gains a `test` script that runs Bun tests then UI vitest tests sequentially
</objective>

<execution_context>
@C:/Projetos/baseworks/.claude/get-shit-done/workflows/execute-plan.md
@C:/Projetos/baseworks/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

<interfaces>
<!-- Current file states (already read by planner) — executor uses these directly -->

packages/ui/package.json (relevant excerpt — no `test` script today):
```json
{
  "name": "@baseworks/ui",
  "scripts": { /* none */ },
  "devDependencies": {
    "vitest": "4.1.3",
    "jsdom": "29.0.2",
    "@testing-library/react": "16.3.2",
    "@testing-library/jest-dom": "6.9.1",
    "vitest-axe": "0.1.0"
  }
}
```

packages/ui/vitest.config.ts (already correct — DO NOT MODIFY):
```ts
export default defineConfig({
  resolve: { alias: { "@tanstack/react-table": "..." } },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

bunfig.toml (current full contents):
```toml
[install]
exact = true
```

package.json (root scripts — no `test` script today):
```json
{
  "scripts": {
    "api": "bun run --watch apps/api/src/index.ts",
    "lint": "biome check .",
    "typecheck": "tsc --noEmit"
    // ... no test script exists
  }
}
```

Test files affected (9 files in packages/ui/src/components/__tests__/, 8 are *.a11y.test.tsx producing the 22 failures; 1 is data-table-cards.test.tsx):
- button.a11y.test.tsx
- dialog.a11y.test.tsx
- dropdown-menu.a11y.test.tsx
- form.a11y.test.tsx
- input.a11y.test.tsx
- select.a11y.test.tsx
- sheet.a11y.test.tsx
- skip-link.a11y.test.tsx
- data-table-cards.test.tsx
</interfaces>

<bun_test_exclusion_notes>
Bun's `bunfig.toml` `[test]` section supports a limited subset of options compared to Jest/Vitest:
- `root = "..."` — scopes test discovery to a specific subdirectory
- `preload = [...]` — files to preload before tests
- `coverage*`, `coverageThreshold` — coverage settings

Bun does NOT have `testPathIgnorePatterns` in bunfig. Two viable strategies:

**Strategy A (preferred — works with bunfig alone):** Bun's CLI accepts positional path filters. Write the root `test` script as `bun test apps packages/auth packages/billing ... && cd packages/ui && bun run test` — explicitly listing test roots EXCEPT packages/ui. Brittle if new packages are added.

**Strategy B (preferred — minimal coupling):** Keep `bun test` discovery as-is at root, but use the `[test]` section's `root` to anchor discovery, then pass an exclusion glob via CLI: `bun test --test-name-pattern '...'`. Bun does NOT support glob exclusion via CLI either.

**Strategy C (RECOMMENDED — robust):** Since Bun 1.1+ honors per-package bunfig.toml files when invoked from that directory, place a `bunfig.toml` in `packages/ui/` with `[test] root = "./vitest-only-no-bun-tests-here"` (a non-existent dir) so any accidental `bun test` invocation from that dir finds nothing. For the ROOT `bun test`, exclude via positional args in the root script: list all top-level test roots EXCEPT packages/ui.

**Strategy D (SIMPLEST and what the executor should try FIRST):** Bun honors a `--test-pattern` glob OR explicit positional dirs. The cleanest root script:
```json
"test": "bun test apps packages/modules packages/auth packages/billing packages/db packages/api-shared packages/contracts packages/eden packages/jobs packages/queue packages/utils 2>/dev/null && cd packages/ui && bun run test"
```
But this requires enumerating packages — fragile.

**Strategy E (MOST ROBUST — use this):** Add a `[test]` section to root `bunfig.toml` and make the discovery exclude `packages/ui` via Bun's documented `root` mechanism. If `root` cannot be a list, use the alternative: rename the UI test files' extension is NOT acceptable (user constraint).

EXECUTOR DECISION: Try this order, picking the FIRST that demonstrably works (verified by `bun test` output not including any packages/ui paths):
1. **Add to root bunfig.toml**: try the `[test]` block with whatever Bun version installed supports for exclusion. Run `bun test --help` first to see exact flags available. Document the actual flag found.
2. **Fallback: positional path filter** in the root `test` script — explicitly enumerate dirs to test. List dynamically detected via `ls apps/ packages/ packages/modules/` minus `packages/ui`.
3. **Verification check:** `bun test 2>&1 | grep -c "packages/ui"` MUST be 0.

DO NOT modify any test files. DO NOT modify vitest.config.ts. DO NOT touch unrelated failing tests (auth-setup.test.ts, get-profile.test.ts).
</bun_test_exclusion_notes>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add vitest test script to packages/ui/package.json</name>
  <files>packages/ui/package.json</files>
  <action>
Add a `scripts` block (currently absent) to `packages/ui/package.json` with a single entry:

```json
"scripts": {
  "test": "vitest run"
}
```

Place the `scripts` block immediately after the `"exports"` block and before `"dependencies"` to match conventional ordering. Use `vitest run` (not bare `vitest`) so the script does NOT enter watch mode — it must exit with a status code so it can be chained from the root script.

Do NOT add any other scripts. Do NOT modify dependencies or any other field. Preserve exact key ordering of unrelated fields and existing 2-space indentation.
  </action>
  <verify>
    <automated>cd packages/ui && bun run test 2>&1 | tail -20 && cd ../.. && cat packages/ui/package.json | grep -A1 '"scripts"'</automated>
  </verify>
  <done>
- `packages/ui/package.json` contains `"test": "vitest run"` under `scripts`
- `cd packages/ui && bun run test` invokes vitest, runs all 9 test files in `src/components/__tests__/`, and the 8 a11y test files pass under jsdom (data-table-cards.test.tsx may have its own status — out of scope to fix here)
- The command exits (does NOT enter watch mode)
- Exit code is 0 if all UI tests pass, non-zero otherwise (this is correct behavior — the planning constraint says these are correctly authored tests being invoked by the wrong runner; under the right runner they should pass)
  </done>
</task>

<task type="auto">
  <name>Task 2: Exclude packages/ui from root bun test discovery via bunfig.toml</name>
  <files>bunfig.toml</files>
  <action>
Determine which exclusion mechanism the installed Bun version supports, then wire it.

Step 1 — Discover available options:
```bash
bun test --help 2>&1 | head -80
bun --version
```

Step 2 — Edit `bunfig.toml` to add a `[test]` section. The current file has only `[install]`; preserve that block and append `[test]` below.

Try Strategy A (preferred — declarative): Add to bunfig.toml:
```toml
[test]
# Exclude packages/ui — those tests run under vitest (jsdom required)
root = "."
```
Then verify with `bun test 2>&1 | grep -c "packages/ui"` — if this returns 0, done.

If Strategy A does NOT exclude packages/ui (it likely won't on its own — `root` only scopes the search start, not exclusions), use Strategy B (CLI-based exclusion baked into the root test script — handled in Task 3). In that case, leave `bunfig.toml` with the `[test]` section as a placeholder/documentation:

```toml
[install]
exact = true

[test]
# Bun's bunfig.toml does not support testPathIgnorePatterns.
# UI tests (packages/ui/src/**/*.test.tsx) are excluded via the root
# package.json `test` script which enumerates test directories explicitly
# and delegates packages/ui to vitest. See package.json scripts.test.
```

The comments document WHY no exclusion option is set here, preventing future devs from assuming bunfig handles the exclusion.

Step 3 — Verify root `bun test` invocation still works (with whatever discovery it does). Do NOT add any non-test config to bunfig. Do NOT modify the `[install]` block.
  </action>
  <verify>
    <automated>cat bunfig.toml && bun test --help 2>&1 | grep -iE "ignore|exclude|pattern" | head -10</automated>
  </verify>
  <done>
- `bunfig.toml` contains both `[install]` block (unchanged) and a new `[test]` block
- The `[test]` block either (a) successfully excludes packages/ui from `bun test` discovery, OR (b) contains explanatory comments noting that exclusion is handled by the root `test` script (Strategy B)
- `bun test --help` output has been reviewed and the chosen approach matches what Bun actually supports
- Existing `[install]` `exact = true` setting is preserved verbatim
  </done>
</task>

<task type="auto">
  <name>Task 3: Add root `test` script orchestrating both runners</name>
  <files>package.json</files>
  <action>
Add a `test` script to the root `package.json` `scripts` block that runs Bun tests for non-UI code, then runs the vitest suite for `packages/ui`. Place the new `test` entry alphabetically appropriately or immediately after `typecheck` (existing convention groups quality scripts together).

If Strategy A from Task 2 successfully excluded packages/ui via bunfig:
```json
"test": "bun test && cd packages/ui && bun run test"
```

If Strategy B is in play (bunfig cannot exclude — exclusion must happen in the script itself), enumerate the test roots explicitly. Discover them dynamically:
```bash
ls -d apps/*/  packages/*/  packages/modules/*/ 2>/dev/null | grep -v "packages/ui/"
```
Then use the resulting list as positional args to `bun test`. Example shape (ACTUAL list must be derived at task execution time from `ls` output, not copied verbatim):
```json
"test": "bun test apps/api packages/auth packages/billing packages/db packages/contracts packages/eden packages/jobs packages/queue packages/utils packages/api-shared packages/modules && cd packages/ui && bun run test"
```

Use `&&` (not `;`) so a Bun-test failure does NOT silently let the UI test run mask the failure. The exit code of the combined script must be the first non-zero exit code encountered.

Constraints:
- Do NOT use `concurrently` or any new dev dependency
- Do NOT change unrelated scripts
- Preserve existing 2-space indentation and key ordering for unrelated fields
- The script MUST be a single line (JSON has no multi-line strings)
- On Windows: `cd packages/ui && bun run test` works in bash/Bun's spawn; do NOT use `pushd`/`popd`
  </action>
  <verify>
    <automated>bun run test 2>&1 | tee /tmp/test-output.log | tail -40 && echo "---UI PATH CHECK---" && grep -c "packages/ui" /tmp/test-output.log | head -1 && echo "---Expected: bun test section has 0 lines mentioning packages/ui paths; vitest section runs after"</automated>
  </verify>
  <done>
- `package.json` contains a `"test"` script under `scripts`
- Running `bun run test` from repo root executes Bun's test runner first (no packages/ui paths appear in its output), then runs `vitest run` in `packages/ui`
- The 22 previously-failing UI a11y tests now pass under vitest+jsdom
- The pre-existing failures `auth-setup.test.ts` and `get-profile.test.ts` are NOT modified — they may still fail (out of scope for this plan; separate /gsd:debug sessions will address them)
- Exit code: non-zero if either runner fails, zero if both pass
  </done>
</task>

</tasks>

<verification>
After all three tasks complete, perform end-to-end verification:

1. **UI tests excluded from Bun's runner:**
   ```bash
   bun test 2>&1 | grep "packages/ui" | wc -l
   ```
   Expected: `0` (no UI test files appear in Bun's output)

2. **The 22 failures are gone from `bun test`:**
   ```bash
   bun test 2>&1 | grep -c "ReferenceError: document is not defined"
   ```
   Expected: `0`

3. **UI tests pass under vitest+jsdom:**
   ```bash
   cd packages/ui && bun run test 2>&1 | tail -10
   ```
   Expected: vitest summary shows the a11y test files passing (data-table-cards.test.tsx may have separate status; not blocking)

4. **Combined root script works:**
   ```bash
   bun run test 2>&1 | tail -10
   ```
   Expected: shows BOTH bun test summary AND vitest summary, in that order
</verification>

<success_criteria>
- `bun test` (root) reports zero `ReferenceError: document is not defined` errors
- `bun test` (root) does not attempt to execute any file under `packages/ui/src/**/*.test.tsx`
- `cd packages/ui && bun run test` runs the a11y tests under jsdom and the 8 `*.a11y.test.tsx` files pass
- `bun run test` (root) runs Bun tests then vitest in sequence, propagating failures
- No test files were modified, no vitest config was modified, no new dependencies were added
- Pre-existing unrelated failures (`auth-setup.test.ts`, `get-profile.test.ts`) remain untouched
</success_criteria>

<output>
After completion, create `.planning/quick/260420-a4t-route-packages-ui-src-test-tsx-through-v/260420-a4t-01-SUMMARY.md` documenting:
- Which exclusion strategy ended up working (bunfig `[test]` keys vs explicit positional args)
- The exact `bun test --help` flags discovered
- Final test counts: bun test pass/fail, vitest pass/fail
- Any pre-existing failures observed (auth-setup, get-profile) noted as out-of-scope carry-overs
</output>
