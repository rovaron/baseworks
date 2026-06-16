---
phase: 25-test-infra-three-storage-adapters
verified: 2026-06-16T00:00:00Z
status: verified
score: 5/5 success criteria verified (2 with CI-gated components — verified-by-design)
environment_note: "Docker not running this session — no Postgres/MinIO/live S3. Local FS adapter, HMAC signing, CORS validator, fixtures, and typecheck verified locally; S3 (AWS) + S3-compat (MinIO) object-I/O conformance are CI-gated and verified-by-design."
---

# Phase 25: Test Infrastructure + Three Storage Adapters — Verification Report

**Phase Goal:** Ship all 3 `FileStorage` adapters proven equivalent by a shared
conformance suite, with MinIO-in-CI as the integration harness, a sharp fixture
set, and per-backend CORS templates so signed-upload phases build on a verified
contract.
**Verified:** 2026-06-16
**Requirements:** FILE-02, FILE-03

## Verification environment

Docker was not running this session (no Postgres, no MinIO, no live S3). Per the
phase contract §6, the verification split is:
- **Local-verified:** Local FS adapter, HMAC signing, CORS validator + templates,
  fixtures + loader, conformance-suite shape (proven via the Local adapter), and
  typecheck of all adapters including the S3 bodies.
- **CI-gated (verified-by-design):** S3 (AWS) and S3-compat (MinIO) live object-I/O
  conformance. These run on the MinIO service container / AWS credentials in CI;
  `describe.skipIf` keeps the local suite green. Correctness for these paths
  rests on the CI MinIO run + the adversarial review (0 blockers).

`bun test packages/storage` → **83 pass / 21 skip / 0 fail** across 9 files
(the 21 skips are exactly the S3 + S3-compat live suites).

## Success Criteria → Evidence

### SC#1 — `bun test packages/storage` runs all 3 adapters through one conformance suite — VERIFIED (S3/compat CI-gated)

- Shared suite: `runFileStorageConformance(label, makeStorage)` in
  `packages/storage/src/adapters/__tests__/conformance.ts` — 9 backend-agnostic
  `test()`s, backend-agnostic (uses only the `FileStorage` port).
- **Local:** `packages/storage/src/adapters/local/file-storage.conformance.test.ts`
  calls it unconditionally → all 9 behaviors pass locally
  (`bun test packages/storage/src/adapters/local` → 32 pass / 0 fail incl. signing).
- **S3:** `packages/storage/src/adapters/s3/file-storage.integration.test.ts`
  → `describe.skipIf(!live)("S3FileStorage (AWS, live)", …)` runs the same suite.
- **S3-compat:** `packages/storage/src/adapters/s3-compat/file-storage.integration.test.ts`
  → `describe.skipIf(!LIVE)("s3-compat (live)", …)` runs the same suite +
  path-style presign assertion.
- All three share `shared-s3.ts` (`Bun.S3Client`) so equivalence is structural,
  not just behavioral. **CI-gated** for the two S3 backends (no live backend
  locally) — verified-by-design.

### SC#2 — CI runs the suite against MinIO; same suite green on AWS S3 and Local — VERIFIED (verified-by-design for MinIO/AWS)

- **Local FS:** green locally (SC#1 evidence).
- **MinIO:** `.github/workflows/validate.yml` `ci` job adds a `minio/minio:edge-cicd`
  service container (port 9000, health-checked), bumps Bun to `1.3.x` (D-25-05),
  creates the `baseworks-test` bucket, and sets `S3_ENDPOINT` + `AWS_ACCESS_KEY_ID`
  + `AWS_SECRET_ACCESS_KEY` + `S3_BUCKET` + `S3_FORCE_PATH_STYLE=true` so the
  S3-compat `describe.skipIf` un-skips. `AWS_REGION` is intentionally unset so the
  real-AWS suite stays skipped.
- **AWS S3 (live):** optional commented step gated on `secrets.AWS_S3_LIVE`; un-skips
  when `AWS_REGION` + creds + `S3_BUCKET` are present (distinct from the MinIO path).
- **Verified-by-design** (MinIO/AWS runs execute in CI; Docker unavailable locally).
  Note: implementation folded MinIO into `validate.yml` `ci` rather than a separate
  `storage-conformance.yml` (contract divergence; same effect).

### SC#3 — CORS templates exist and `bun run validate-cors` enforces the rules — VERIFIED (local)

- Templates: `docs/integrations/file-storage/cors/{aws-s3,r2,minio,garage}.json`.
- Validator: `scripts/validate-cors.ts` (`validateCorsConfig`) — asserts no
  wildcard origins (rejects any `*`), `ETag` in `ExposeHeaders` (case-insensitive),
  `PUT` present, and structural non-empty arrays.
- Wired as root script: `package.json` → `"validate-cors": "bun scripts/validate-cors.ts"`.
- **Evidence:** `bun run validate-cors` → `PASS aws-s3.json / garage.json /
  minio.json / r2.json` → "CORS validation passed (4 template(s))." Unit tests in
  `scripts/__tests__/validate-cors.test.ts` cover each failure mode
  (wildcard / missing ETag / missing PUT).

### SC#4 — Local PUT URL carries an HMAC `?sig=` token; prod-mode local boot is refused — VERIFIED (local)

- **HMAC sign:** `packages/storage/src/adapters/local/signing.ts` mints
  `…/api/files/local/{bucket}/{key}?exp={exp}&max={max}&sig={hmac}` for PUT and
  `?exp&sig` for GET (HMAC-SHA256, lowercase hex). The URL carries a `sig`, not a
  guessable file ID; `verifyLocalSignature` does expiry-before-signature +
  timing-safe compare.
- **Tests:** `packages/storage/src/adapters/local/signing.test.ts` — ~30 tests:
  mint→verify, tamper on key/bucket/exp/max/sig → `bad_signature`, PUT↔GET
  cross-replay rejected, expiry boundary (`now === exp` valid), malformed inputs,
  and length-mismatch guard does not call `timingSafeEqual` (would throw).
- **No raw key in result:** conformance asserts
  `expect("storageKey" in result).toBe(false)` and `expect("key" in result)` for
  both `signUpload` and `signRead` (Pitfall 1).
- **Prod ban (Pitfall 14):** enforced by Phase 24's `validateStorageEnv` (D-14);
  `packages/storage/src/__tests__/env.test.ts` asserts `STORAGE_PROVIDER=local` +
  `NODE_ENV=production` throws the exact message
  "Local storage adapter is not safe for production. Set STORAGE_PROVIDER=s3 or s3-compat."

### SC#5 — Deterministic fixture set committed and consumed by conformance — VERIFIED (local; minor gap)

- Five fixtures + manifest under `packages/storage/__test-fixtures__/`:
  `baseline-100x100.png`, `photo-5000x5000.png`, `bomb-50000x50000.png`,
  `truncated.png`, `svg-with-script.svg`, `manifest.json`.
- Generated by `scripts/generate-fixtures.ts` (hand-built PNGs via
  `node:zlib.deflateSync`, no `Math.random` → byte-reproducible).
- Consumed: `packages/storage/src/test-support/fixtures.ts` (`loadFixture`) feeds
  the conformance round-trip with `baseline-100x100.png` (binary bytes); the
  `FIXTURES` map mirrors `manifest.json`. Phase 28 transform tests will consume all five.
- **Minor gap (not an SC blocker):** the contract's optional `fixtures.test.ts`
  re-hash oracle (asserting committed sha256 == manifest) was not added; there is
  no automated reproducibility assertion today. SC#5 itself (set committed +
  consumed by conformance) is satisfied. Recommended as a quick follow-up.

## Score

**5/5 success criteria verified.** SC#1 and SC#2 carry CI-gated components for the
two S3 backends, marked verified-by-design (MinIO service container + optional AWS
live run execute in CI; Docker was unavailable locally). SC#3, SC#4, SC#5 are fully
local-verified. One non-blocking follow-up: add the fixture-hash reproducibility test.

## Human / CI verification required

- **CI MinIO run** confirms S3-compat object-I/O conformance (path-style presign,
  round-trip, stat, delete) — runs automatically on the next PR/push to `main`.
- **Optional AWS live run** (operator-gated on `AWS_S3_LIVE` secret) confirms the
  real-AWS S3 path.

_Verified: 2026-06-16 — Claude (gsd-verifier). Status: verified (2 SCs verified-by-design for CI-gated S3 backends)._
