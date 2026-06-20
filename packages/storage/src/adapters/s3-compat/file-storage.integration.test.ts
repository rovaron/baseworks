/**
 * S3CompatFileStorage integration tests (Phase 25 / FILE-02 / FILE-03 — D-25-04).
 *
 * Runs the shared `runFileStorageConformance` suite against a live
 * S3-compatible backend (MinIO in CI). Gated by `describe.skipIf` so the
 * default local suite stays green when no S3 endpoint/credentials are present:
 * the live object-I/O behaviors (#2–#6) need MinIO. CI's
 * `storage-conformance.yml` sets `S3_ENDPOINT` + creds + `S3_BUCKET` to
 * un-skip this suite (contract §6 — CI-gated).
 *
 * Named `*.integration.test.ts` and gated rather than always-on because Docker /
 * MinIO is absent in local dev sessions (contract §6 verification split).
 *
 * Also asserts the path-style addressing mapping (R3): with
 * `S3_FORCE_PATH_STYLE=true` (CI default), the presigned URL must be path-style
 * — `{endpoint}/{bucket}/{key}` — not vhost-style. This needs no live backend
 * (presign is pure SigV4 crypto), so it runs whenever creds are configured.
 */
import { describe, expect, test } from "bun:test";
import { runFileStorageConformance } from "../__tests__/conformance";
import { S3CompatFileStorage } from "./file-storage";

/** Live iff a custom S3 endpoint AND credentials AND a bucket are configured. */
const LIVE =
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.AWS_ACCESS_KEY_ID) &&
  Boolean(process.env.AWS_SECRET_ACCESS_KEY) &&
  Boolean(process.env.S3_BUCKET);

// Full behavioral contract against the live S3-compat backend (MinIO in CI).
describe.skipIf(!LIVE)("s3-compat (live)", () => {
  runFileStorageConformance("s3-compat", () => new S3CompatFileStorage());

  // Path-style addressing assertion (R3): presign is pure crypto, but it still
  // needs the endpoint/creds to construct the client, so it lives under the
  // same skip gate. CI sets S3_FORCE_PATH_STYLE=true → expect bucket-in-path.
  test("presigned URL is path-style when S3_FORCE_PATH_STYLE=true", async () => {
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false";
    // Only meaningful for the path-style configuration CI exercises.
    if (!forcePathStyle) {
      return;
    }

    const storage = new S3CompatFileStorage();
    const { url } = await storage.signRead({
      bucket: "conformance",
      key: "addressing-probe.png",
      expiresInSec: 60,
    });

    const endpoint = process.env.S3_ENDPOINT as string;
    const { host: endpointHost } = new URL(endpoint);
    const parsed = new URL(url);

    // Path-style: host is the bare endpoint host (no bucket subdomain), and the
    // bucket is the first path segment.
    expect(parsed.host).toBe(endpointHost);
    expect(parsed.pathname.startsWith("/conformance/")).toBe(true);
  });
});
