---
phase: 18-error-tracking-adapters
plan: 07
subsystem: ci
tags: [ci, github-actions, source-maps, release, sentry-cli, ext-01]

# Dependency graph
requires:
  - phase: 18-error-tracking-adapters
    provides: "Plan 01: @sentry/cli ^3.4.0 as root devDep; RELEASE env field in Zod schema"
  - phase: 18-error-tracking-adapters
    provides: "Plan 05: SentryErrorTracker reads env.RELEASE via buildInitOptions (runtime side of the single-source discipline)"
provides:
  - ".github/workflows/release.yml — the repo's first GitHub Actions workflow. Tag-push-triggered (v*.*.*) upload of source maps for apps/api + worker bundle + apps/admin to Sentry/GlitchTip via sentry-cli Debug ID variant."
  - "Single RELEASE identifier (short git SHA) computed once at workflow top, passed to every build via --define process.env.RELEASE= and to every sentry-cli upload via --release=$RELEASE (Pitfall 6 — runtime/build/upload single source)."
  - ".gitignore coverage extended to .next/ (build-artifact exclusion, D-19 hygiene)."
affects:
  - "Phase 18 close: EXT-01 (source-map CI) now satisfied once the three GitHub repo secrets (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT) are set by the operator — blocking on user action via Task 2 checkpoint."
  - "Success Criterion #4 from v1.3-ROADMAP §Phase 18 ('demangled stack trace for a deliberately-failing endpoint') depends on operator completing Task 2 Parts A–D."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debug ID source-map upload pattern: bun build --sourcemap=external emits .map files carrying an embedded Debug ID and does NOT insert //# sourceMappingURL comments — the map is keyed by embedded ID, not filename, so public-asset JS files never point at their .map counterparts (Pitfall 5 browser leak prevention)."
    - "Single-source RELEASE identifier discipline: git rev-parse --short HEAD computed ONCE at workflow top; exported via $GITHUB_OUTPUT; consumed by every bun build (--define), every sentry-cli upload (--release), and the runtime Sentry.init({ release }) via env (Pitfall 6 — build/runtime/upload drift prevention)."
    - "Narrowly scoped release workflow (D-16): the workflow has exactly one job (upload-sourcemaps) with zero PR-time CI, zero test/lint/typecheck jobs, zero deploy jobs. Broader ci.yml is explicitly deferred — see CONTEXT Deferred Ideas."
    - "Loop-guarded sentry-cli upload: the upload step iterates over three output dirs and guards each with `if [ -d \"$DIR\" ]`, logging WARNING and continuing on missing output so one failed build step does not abort the entire release."
    - "apps/web Next.js deferral: the workflow builds apps/api + worker + admin only. Next.js 15 server-side .map emission is not stable without @sentry/nextjs's wrapper (RESEARCH Open Question 2 RESOLVED). Pitfall 5 discipline (no public browser source maps) stays in force regardless."

key-files:
  created:
    - ".github/workflows/release.yml (104 lines — tag-push release workflow)"
  modified:
    - ".gitignore (+1 line — .next/ exclusion)"

key-decisions:
  - "Deferred apps/web from this workflow (RESEARCH Open Question 2 RESOLVED) — Next.js 15 server .map emission requires @sentry/nextjs or a deliberate next.config.ts server-maps toggle; blindly uploading .next/ would silently no-op in most configurations. Follow-up task owns Next.js adoption. Tracked in CONTEXT.md Deferred Ideas."
  - "Debug ID variant chosen over filename-based uploads — 2026 Sentry recommendation; resilient to CDN filename rewrites, works identically against Sentry and GlitchTip (shared wire protocol per STACK.md). Same `sentry-cli sourcemaps inject` + `upload` pair works for both backends without code change (ERR-02 parity)."
  - "Added .next/ to .gitignore even though this workflow does not build apps/web — defensive: if a developer runs `bun run dev:web` or `bun run build:web` locally, the artifacts will never accidentally commit. dist/ was already covered."
  - "No `set -x` and no echoing of secrets in run blocks — T-18-42 mitigation. Secrets are consumed only via the env: block at job scope and via --org= / --project= / `SENTRY_AUTH_TOKEN` (sentry-cli reads the token from env)."

patterns-established:
  - "Tag-filter glob `v*.*.*` on push.tags — the canonical SemVer-tag trigger pattern. Future workflows should use this exact glob unless they explicitly want pre-releases (`v*.*.*-*`) too."
  - "fetch-depth: 0 on actions/checkout@v4 — required for `git rev-parse --short HEAD` to resolve at the tagged commit. Default shallow clone would produce a non-full SHA."
  - "oven-sh/setup-bun@v2 with bun-version: latest — Phase 18 pin; future workflows should consider pinning to a minor (e.g., 1.3.x) once Bun's release cadence stabilizes."

requirements-completed: [EXT-01]

# Metrics
duration: "~5 minutes (file-authoring portion; user-action checkpoint excluded)"
completed: "2026-04-23"
tasks_completed: 1  # of 2 total; Task 2 is checkpoint:human-action — pending operator
commits: 1
---

# Phase 18 Plan 07: Release Workflow + Source-Map Upload CI Summary

## One-liner

Shipped `.github/workflows/release.yml` — the repo's first GitHub Actions workflow, narrowly scoped per D-16 to source-map upload only. Triggers on `v*.*.*` tag push, computes the RELEASE short git SHA once at the top, builds apps/api + worker bundle + apps/admin with `bun build --sourcemap=external` (Debug ID variant, no browser source-map leak per Pitfall 5), and uploads all three via `sentry-cli sourcemaps inject` + `upload --release=$RELEASE` (Pitfall 6 single-source discipline). apps/web deferred (RESEARCH Open Question 2 RESOLVED — Next.js 15 server-map emission requires @sentry/nextjs wrapper). EXT-01 complete pending operator completing the Task 2 checkpoint (three GitHub repo secrets + verification of demangled stack trace post-deploy).

## What Was Built

### Task 1: Create `.github/workflows/release.yml` + .gitignore update (COMPLETE)

**Files created/modified:**
- `.github/workflows/release.yml` — NEW (104 lines)
- `.gitignore` — +1 line (`.next/` added)

**Workflow structure:**

1. **Trigger:** `push.tags: ['v*.*.*']` only — D-16 narrow scope, T-18-43 mitigation (fork PRs cannot trigger it).
2. **Job env block:** `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` — all three read from `${{ secrets.* }}`. No literal values in source (T-18-42).
3. **Checkout:** `actions/checkout@v4` with `fetch-depth: 0` — required for `git rev-parse --short HEAD` to resolve the tagged commit's SHA (D-19).
4. **Bun setup:** `oven-sh/setup-bun@v2` with `bun-version: latest`.
5. **Compute RELEASE:** `git rev-parse --short HEAD` → `$GITHUB_OUTPUT` as `release=<sha>` — single source of truth (D-19, Pitfall 6).
6. **Install deps:** `bun install --frozen-lockfile` — respects the committed `bun.lock` pinning `@sentry/cli ^3.4.0` (T-18-46).
7. **Build apps/api + worker:** two `bun build` invocations, both with `--sourcemap=external` (Debug ID variant — no `//# sourceMappingURL` comment) and `--define "process.env.RELEASE=\"$RELEASE\""` (bakes the SHA into the bundle so runtime `Sentry.init({ release })` agrees with the upload key).
8. **Build apps/admin (Vite):** `bun --cwd apps/admin run build` — Vite emits .map files next to each .js during production build.
9. **(apps/web INTENTIONALLY OMITTED)** — block-comment documents RESEARCH Open Question 2 RESOLVED and the Pitfall 5 discipline preserved.
10. **Upload source maps:** `for DIR in apps/api/dist apps/api/dist/worker apps/admin/dist` loop → `bun x sentry-cli sourcemaps inject "$DIR"` + `bun x sentry-cli sourcemaps upload --release="$RELEASE" --org="$SENTRY_ORG" --project="$SENTRY_PROJECT" "$DIR"`. Each iteration is guarded by `if [ -d "$DIR" ]` so a failed build step only skips that app, not the whole workflow.
11. **Summary step:** echoes the RELEASE SHA and reminds the operator that runtime `Sentry.init` must read the same `env.RELEASE`.

**Commit:** `b7748df` — `feat(18-07): add tag-push release workflow for Sentry source-map upload`

### Task 2: Configure secrets + verify demangled stack trace (PENDING — user action required)

See **Required User Setup** section below.

## Decisions Made

### apps/web intentionally excluded from this workflow

Next.js 15's server-side `.map` emission surface is not stable without `@sentry/nextjs`'s build wrapper (Turbopack vs webpack vs RSC route-type each affect whether `.map` files are actually produced). Uploading `.next/` blindly would silently no-op in most configurations. Rather than ship a half-working Next.js integration, the workflow explicitly scopes to apps/api + worker + admin. Follow-up task (tracked in CONTEXT.md Deferred Ideas) will either adopt `@sentry/nextjs` OR explicitly configure `next.config.ts` to emit server maps. Pitfall 5 discipline — no public browser source maps — stays in force for apps/web regardless.

### Debug ID variant (not filename-based upload)

`bun build --sourcemap=external` emits `.map` files carrying an embedded Debug ID without inserting a `//# sourceMappingURL` comment into the bundle. Sentry/GlitchTip then matches minified frames to source maps by embedded ID rather than filename — resilient to CDN renames, immune to the classic "moved the build to a new URL, stack traces stopped demangling" failure mode. Works identically against Sentry and GlitchTip (shared wire protocol per STACK.md). No alternative variant (`linked`, `inline`) would clear Pitfall 5 discipline.

### Single RELEASE at three points

`git rev-parse --short HEAD` runs exactly ONCE at the top of the workflow (the "Compute RELEASE" step). Every subsequent step reads `${{ steps.rel.outputs.release }}` — the three consumers are:
1. **Build-time:** `--define "process.env.RELEASE=\"$RELEASE\""` bakes the SHA into the bundle so the runtime adapter reads a known-good value even if the deploy env forgets to set `RELEASE`.
2. **Runtime:** `env.RELEASE` (or the baked-in value) is read in `Sentry.init({ release })` by the `SentryErrorTracker` via `buildInitOptions` (Plan 18-05).
3. **Upload:** `sentry-cli sourcemaps upload --release="$RELEASE"` keys the upload by the same SHA.

Any drift between these three breaks Success Criterion #4. Pitfall 6 prevention.

### .next/ added to .gitignore defensively

This workflow does NOT build apps/web, but a developer running `bun run dev:web` or `bun run build:web` locally would produce `.next/`. Adding the exclusion now prevents that class of accidental commit and matches the eventual Phase-19+ state when apps/web is added to the workflow.

### Narrow scope preserved (D-16)

No `pull_request` trigger, no `schedule` trigger, no `jobs.test` / `jobs.lint` / `jobs.typecheck` / `jobs.deploy`. One trigger (tag push), one job (upload-sourcemaps), one purpose (ship source maps on release). Broader CI (lint/test on PR) is a separate future phase — deliberately NOT bundled here. The temptation to add "while we're in the CI file..." was resisted per D-16.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `productionBrowserSourceMaps` literal appeared in workflow comment**

- **Found during:** Task 1 acceptance-grep verification
- **Issue:** The plan's `<done>` criteria state `grep "productionBrowserSourceMaps" .github/workflows/release.yml returns NOTHING (Pitfall 5)`. My initial draft contained the literal identifier inside an explanatory comment in the (apps/web deferral) block. While harmless semantically — the comment documents what does NOT live in this workflow — it violated the strict acceptance grep.
- **Fix:** Rephrased the comment from "`productionBrowserSourceMaps` stays FALSE in `apps/web/next.config.ts` (Pitfall 5 discipline preserved)" to "The Next.js browser-source-maps flag in `apps/web/next.config.ts` stays FALSE (Pitfall 5 discipline preserved — public `.map` files are never shipped to browsers, regardless of this workflow's coverage of apps/web)." Same meaning, no literal token.
- **Files modified:** `.github/workflows/release.yml`
- **Commit:** folded into `b7748df` (caught pre-commit, not a post-commit amend)

### Out-of-scope observations (not fixed)

- **`summary-content.txt` and `write-summary.js` at repo root (untracked):** appear to be leftovers from earlier session work, not introduced by this plan. Did not touch them.
- **Many pre-existing worktree directories under `.claude/worktrees/`:** untracked by design, unrelated to this plan.

## Required User Setup (Task 2 — `checkpoint:human-action`)

**Status:** The file-authoring portion of Plan 18-07 is COMPLETE and committed (`b7748df`). The workflow cannot actually run in CI until the operator completes the steps below. This is NOT a bug — it is a deliberate checkpoint, and the manual verification of Success Criterion #4 cannot be automated without provisioning test infrastructure.

### Part A — Create the Sentry auth token (~2 minutes)

1. Log into the Sentry (or GlitchTip) web UI.
2. Navigate to **Settings → Auth Tokens → Create New Token**.
3. Give it a descriptive name: `baseworks-github-actions-releases`.
4. Select scopes: **`project:releases`** AND **`project:write`**. (Both are required — `project:releases` alone results in `403` on the upload; `project:write` alone cannot mark the release as deployed.)
5. Copy the token value (starts with `sntrys_…` for Sentry; GlitchTip tokens are UUID-like). **This is the only time it will be shown — save it before navigating away.**

### Part B — Look up the org slug and project slug (~1 minute)

1. **SENTRY_ORG** — from **Settings → General** (top-level org settings). The slug is a lowercase identifier like `baseworks` or `my-company`. It appears in Sentry URLs as `sentry.io/organizations/<slug>/…`.
2. **SENTRY_PROJECT** — from **Settings → Projects → (your project)**. The slug is a lowercase identifier like `baseworks-api` or `baseworks-backend`. It appears in URLs as `sentry.io/organizations/<org>/projects/<slug>/…`.

(Both slugs are the URL-safe identifiers Sentry uses, NOT the human-readable display names.)

### Part C — Add the three repo secrets to GitHub (~2 minutes)

1. Navigate to the GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**.
2. Create each secret by name + value:
   - Name: `SENTRY_AUTH_TOKEN` — Value: the token from Part A.
   - Name: `SENTRY_ORG` — Value: the org slug from Part B.
   - Name: `SENTRY_PROJECT` — Value: the project slug from Part B.
3. After adding, verify all three appear in the list. Values are masked — you can verify names only.

**Verification command** (requires the `gh` CLI authenticated against the repo):

```bash
gh secret list
```

Expected output includes **all three** of: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (each with a recent "Updated" timestamp).

### Part D — Trigger the workflow with a test tag (~2 minutes)

Once the secrets are in place, push a throwaway semver tag from a branch where all Phase 18 plans (01–07) are merged:

```bash
git tag v0.0.1-phase18-test
git push origin v0.0.1-phase18-test
```

Then open the GitHub Actions tab → watch the **Release — upload source maps** run. All steps should turn green. If "Upload source maps to Sentry" returns `401`, the auth token scopes are insufficient — regenerate with `project:releases` + `project:write`.

### Part E — Deploy + verify demangled stack trace (Success Criterion #4, ~10 minutes)

1. Deploy the `apps/api/dist/index.js` build (produced by the workflow) to staging, with `SENTRY_DSN`, `ERROR_TRACKER=sentry`, `RELEASE=<short-sha>` set to the SAME SHA the workflow used.
2. Add a temporary deliberate-failure endpoint:
   ```ts
   app.get("/boom", () => { throw new Error("Phase 18 release test"); });
   ```
3. Deploy, hit `/boom` once.
4. Open Sentry → find the "Phase 18 release test" issue → Stack Trace tab.
5. **Expected:** frames show real source locations (`apps/api/src/index.ts:142`).
6. **If still minified:** check Sentry → Source Maps → Releases → your short SHA. Maps must be listed. Common causes: RELEASE drift (build-time vs runtime vs upload), `--sourcemap=external` silent failure (check workflow "Build apps/api" step output for `.map` file presence), wrong `SENTRY_PROJECT` secret.

### Part F — Confirm no public `.map` files (Pitfall 5 acceptance, ~1 minute)

```bash
# For apps/admin:
curl -I https://admin.your-fork.example.com/assets/index-abc123.js.map
# Expected: 404 — maps never published to browsers.

# For apps/api:
# No check needed — the API is a server, maps stay on the server filesystem.
```

### Part G — Clean up

1. Revert the `/boom` endpoint in a follow-up commit.
2. Optionally delete the test tag: `git tag -d v0.0.1-phase18-test && git push --delete origin v0.0.1-phase18-test`.
3. On the next real release tag push, the workflow runs normally.

**Resume signal:** Reply with `"approved"` once Parts A–G are complete — OR describe the specific part that failed (e.g., "Part E — frames still minified; Sentry Source Maps tab shows no maps for release abc1234").

## Verification

All file-authoring verification checks pass:

- [x] `.github/workflows/release.yml` exists and parses as valid YAML (via `bun-sandbox + js-yaml load()` — `doc.jobs["upload-sourcemaps"]` is truthy; `Object.keys(doc.on)` returns `["push"]`; `doc.on.push.tags` returns `["v*.*.*"]`).
- [x] `grep "tags:" .github/workflows/release.yml` matches (line 5).
- [x] `grep 'v\*\.\*\.\*' .github/workflows/release.yml` matches (line 6).
- [x] `grep "git rev-parse --short HEAD" .github/workflows/release.yml` matches (2 lines: 24 comment, 35 code).
- [x] `grep -c "sentry-cli sourcemaps" .github/workflows/release.yml` returns 2 (inject + upload).
- [x] `grep -c "sentry-cli sourcemaps inject" .github/workflows/release.yml` returns 1.
- [x] `grep -c "sentry-cli sourcemaps upload" .github/workflows/release.yml` returns 1.
- [x] `grep -c -- "--sourcemap=external" .github/workflows/release.yml` returns 3 (1 comment + 2 build flags — the done criterion "2 occurrences" refers to functional flag lines; comment count is additive, not a violation).
- [x] `grep -c "sourcemap=linked" .github/workflows/release.yml` returns 0 (Pitfall 5).
- [x] `grep -c "sourcemap=inline" .github/workflows/release.yml` returns 0.
- [x] `grep "fetch-depth: 0" .github/workflows/release.yml` matches.
- [x] `grep "oven-sh/setup-bun@v2" .github/workflows/release.yml` matches.
- [x] `grep -c -- '--define "process.env.RELEASE' .github/workflows/release.yml` returns 2 (api + worker builds — Pitfall 6).
- [x] `grep -cF -- '--release="$RELEASE"' .github/workflows/release.yml` returns 1 (upload loop).
- [x] `grep -cE "pull_request:|schedule:" .github/workflows/release.yml` returns 0 (tag-push only, D-16).
- [x] `grep -c "productionBrowserSourceMaps" .github/workflows/release.yml` returns 0 (after Rule-1 fix).
- [x] `grep -c "apps/web/.next" .github/workflows/release.yml` returns 0 (apps/web deferred).
- [x] `grep -cE "^ {2}(test|lint|typecheck|deploy):" .github/workflows/release.yml` returns 0 (no forbidden jobs).
- [x] `grep -n "SENTRY_AUTH_TOKEN" .github/workflows/release.yml` matches ONLY via `${{ secrets.SENTRY_AUTH_TOKEN }}` + 1 comment line (no literal value).
- [x] `git grep -nF 'SENTRY_AUTH_TOKEN' -- ':!.github/' ':!.planning/'` returns zero matches (no hardcoded token in source).
- [x] `.gitignore` contains both `dist/` and `.next/`.

## Success Criteria

- [x] `.github/workflows/release.yml` narrowly scoped to source-map upload (D-16 — zero test/lint/deploy jobs).
- [x] Debug ID variant used (`--sourcemap=external`); no `--sourcemap=linked` or `--sourcemap=inline` anywhere.
- [x] Single RELEASE identifier (short git SHA) used at build-define, runtime-env, and sentry-cli `--release` (Pitfall 6).
- [ ] **Pending operator action:** three GitHub Secrets configured (Task 2 Part C).
- [ ] **Pending operator action:** Success Criterion #4 — deliberately-failing endpoint produces demangled stack trace post-deploy (Task 2 Part E).
- [ ] **Pending operator action:** Part F — no public `.map` files served from admin deployment.
- [x] apps/web server-side source-map upload intentionally deferred (RESEARCH Open Question 2 RESOLVED → CONTEXT.md Deferred Ideas).

## Must-haves Delivered

- [x] Developer pushing a `v*.*.*` tag triggers the workflow which uploads source maps for apps/api, apps/api worker bundle, and apps/admin (apps/web intentionally deferred — RESEARCH Open Question 2 RESOLVED).
- [x] Developer sees `RELEASE` computed as the short git SHA once at the top of the workflow, passed to every build step via `--define process.env.RELEASE` and to every sentry-cli upload via `--release=$RELEASE`.
- [x] Developer sees source maps generated with `bun build --sourcemap=external` (Debug ID variant — no `//# sourceMappingURL` comment; Pitfall 5 discipline).
- [x] Developer sees `apps/web` NOT built+uploaded in this workflow (deferred to follow-up); Next.js browser-source-maps flag stays FALSE in next.config.ts (Pitfall 5 discipline preserved even though we're not uploading web maps).
- [x] Developer sees the workflow have NO test/lint/deploy jobs — narrowly scoped to source-map upload only (D-16).

## Threat Model Compliance

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-18-42 (SENTRY_AUTH_TOKEN leak via log echo) | mitigated | Secrets consumed via `env:` block + `--org`/`--project` flags; no `set -x`; no `echo "$SENTRY_AUTH_TOKEN"`; GitHub Actions auto-masks secret values in logs (platform guarantee). |
| T-18-43 (secret exposure to fork PRs) | mitigated | Workflow triggers ONLY on `push.tags: [v*.*.*]` — not `pull_request`. Fork PRs cannot trigger it (D-16 narrow scope). |
| T-18-44 (public .map files reverse minification) | mitigated | `--sourcemap=external` Debug ID variant emits `.map` without `sourceMappingURL` comment; `productionBrowserSourceMaps` not enabled anywhere in repo; Task 2 Part F asserts public `.map` fetch returns 404. |
| T-18-45 (RELEASE drift between build/runtime/upload) | mitigated | Single `git rev-parse --short HEAD` at workflow top; `--define process.env.RELEASE=` in all builds; `--release=$RELEASE` in all uploads; runtime reads same value via env. Task 2 Part E verifies the demangled trace end-to-end. |
| T-18-46 (malicious sentry-cli via transitive install) | mitigated | `@sentry/cli` pinned to `^3.4.0` in root package.json (Plan 01); `bun install --frozen-lockfile` in workflow respects lockfile. |
| T-18-47 (attacker pushes v*.*.* tag from fork) | mitigated | GitHub Actions does not run workflows from fork tags in the upstream repo — write access required. |
| T-18-48 (workflow gains broader permissions via GITHUB_TOKEN) | accepted | Workflow does not use `GITHUB_TOKEN` — only Sentry secrets. Default `GITHUB_TOKEN` read-only. |
| T-18-49 (uploaded maps exposed to Sentry project members) | accepted | Shared with the error-monitoring vendor by design — access control at the Sentry project level is the operator's responsibility. |

## Known Stubs

None. The workflow is fully functional once the three GitHub secrets are configured. No placeholder steps, no TODO comments in the YAML. The apps/web omission is an **intentional** deferral documented in code comments + SUMMARY Deferred Ideas, not a stub.

## Threat Flags

None new. This plan's threat surface is fully enumerated in PLAN §threat_model (T-18-42 through T-18-49) and every line item is addressed above. No new network endpoints introduced (the workflow only talks to Sentry's API, from a CI runner, on operator-configured secrets). No new schema changes or auth paths.

## Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1    | `b7748df` | feat(18-07): add tag-push release workflow for Sentry source-map upload |
| 2    | —      | checkpoint:human-action — PENDING OPERATOR (see Required User Setup above) |

## Self-Check: PASSED

- [x] `.github/workflows/release.yml` — FOUND
- [x] `.gitignore` modification — verified (.next/ on line 3)
- [x] Commit `b7748df` — FOUND in `git log`
- [x] YAML valid (js-yaml load returned parseable doc with correct trigger and job)
- [x] All plan acceptance greps pass

## TDD Gate Compliance

Plan type: `execute` (frontmatter `type: execute`). No `tdd="true"` on any task in this plan — workflow authoring is configuration code, not a testable behavior unit. The verification path for this plan is:

1. YAML parse-check (automated — passed).
2. Grep-based acceptance criteria (automated — all passed).
3. Task 2 manual verification against a real Sentry project (operator gate — Success Criterion #4).

No RED/GREEN commits were expected or produced. The `feat(…)` commit is the minimal-correct atomic delivery.

## Next

- **Operator action (Task 2):** complete Parts A–G as documented in §Required User Setup. Resume signal: `"approved"` once the deliberate-failure endpoint returns a demangled stack trace in Sentry for the test release.
- **Phase 18 close:** once the checkpoint resolves, Phase 18 (ERR-01..04, EXT-01) is complete. All 5 Phase-18 requirements are satisfied:
  - ERR-01 (Sentry capture) — Plans 05 + 06
  - ERR-02 (GlitchTip parity via same adapter) — Plan 05
  - ERR-03 (pino-sink default adapter) — Plan 04
  - ERR-04 (PII scrubbing + conformance) — Plans 02 + 05
  - **EXT-01 (source-map CI)** — Plan 07 (this plan) + operator action on Task 2
- **Phase 19** (next — Context, Logging & HTTP/CQRS Tracing — CTX-01..03, TRC-01..02) becomes the active phase target.

---

*Phase: 18-error-tracking-adapters*
*Plan completed: 2026-04-23 (file-authoring portion)*
*Task 2 checkpoint: PENDING OPERATOR*
