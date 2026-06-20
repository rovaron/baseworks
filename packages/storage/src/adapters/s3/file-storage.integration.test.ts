/**
 * Phase 25 / FILE-02 / FILE-03 — S3 (AWS) adapter conformance (D-25-04 / D-25-05).
 *
 * Runs the shared `runFileStorageConformance` suite against the real
 * `S3FileStorage` (Bun.S3Client → AWS S3). Object-I/O behaviors (2–6) need a live
 * S3 endpoint + real credentials, which are absent in local/dev and in the
 * default CI `ci` job, so the whole suite is wrapped in `describe.skipIf(!live)`:
 *
 *   live = AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION + S3_BUCKET present.
 *
 * Locally (no creds) the suite is SKIPPED and the storage test run stays green;
 * it RUNS only where an operator wires real AWS credentials (D-25-05 requires Bun
 * ≥ 1.2 for `Bun.S3Client`). The MinIO-backed S3-compat suite is the always-on CI
 * gate; this AWS suite is opt-in via credentials.
 *
 * `.integration.test.ts` marks it as the live-backend tier (vs the always-local
 * unit/conformance tiers).
 */
import { describe } from "bun:test";
import { runFileStorageConformance } from "../__tests__/conformance";
import { S3FileStorage } from "./file-storage";

/** Live iff every AWS credential + bucket the adapter needs is present. */
const live = Boolean(
  process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION &&
    process.env.S3_BUCKET,
);

describe.skipIf(!live)("S3FileStorage (AWS, live)", () => {
  runFileStorageConformance("s3", () => new S3FileStorage());
});
