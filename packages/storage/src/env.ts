/**
 * validateStorageEnv() — boot-time storage env validator (Phase 24 / FILE-01).
 *
 * Mirrors validateObservabilityEnv() in the shared config package (Phase 17/18).
 * Crashes hard on missing required env keys for the selected adapter.
 *
 * Per CONTEXT D-13 / D-14:
 *   - STORAGE_PROVIDER defaults to "local" (D-10).
 *   - When STORAGE_PROVIDER=local AND NODE_ENV=production, crash hard with
 *     the locked Pitfall 14 message — D-14 enforces this in Phase 24 even
 *     though the Local adapter body arrives in Phase 25 (the prod-safety
 *     contract IS the foundation).
 *   - Selective per-provider validation: only the SELECTED provider's
 *     required vars are checked. Each missing var crashes with a message
 *     that NAMES the missing var.
 *   - NODE_ENV=test relaxes everything to console.warn, mirroring
 *     validatePaymentProviderEnv()'s isTest pattern.
 *
 * IMPORTANT: This file reads `process.env` directly. It does NOT import the
 * shared config package to avoid coupling @baseworks/storage to the
 * @t3-oss/env schema (which would force callers to add storage envs to
 * packages/config).
 *
 * Security:
 *   - Crash messages NAME the missing var only — never echo a partial/full
 *     value (T-24-04-01 mitigation).
 *   - Throws BEFORE the factory's first call so secrets-in-memory never
 *     transit through silent NoOp paths.
 *
 * @throws Error if a selected provider is missing required env keys, OR if
 *   STORAGE_PROVIDER=local && NODE_ENV=production (D-14).
 */
export function validateStorageEnv(): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isTest = nodeEnv === "test";
  const provider = process.env.STORAGE_PROVIDER ?? "local";

  switch (provider) {
    case "local":
      if (nodeEnv === "production") {
        throw new Error(
          "Local storage adapter is not safe for production. Set STORAGE_PROVIDER=s3 or s3-compat.",
        );
      }
      // STORAGE_LOCAL_PATH defaults to "./storage" — no missing-var check needed.
      break;

    case "s3": {
      const requiredS3 = [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_REGION",
        "S3_BUCKET",
      ] as const;
      for (const v of requiredS3) {
        if (!process.env[v]) {
          if (isTest) {
            console.warn(`[env] WARNING: ${v} is not set (NODE_ENV=test).`);
          } else {
            throw new Error(
              `${v} is required when STORAGE_PROVIDER=s3. Set ${v} in your environment.`,
            );
          }
        }
      }
      break;
    }

    case "s3-compat": {
      const requiredS3Compat = [
        "S3_ENDPOINT",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "S3_BUCKET",
        "S3_FORCE_PATH_STYLE",
      ] as const;
      for (const v of requiredS3Compat) {
        if (!process.env[v]) {
          if (isTest) {
            console.warn(`[env] WARNING: ${v} is not set (NODE_ENV=test).`);
          } else {
            throw new Error(
              `${v} is required when STORAGE_PROVIDER=s3-compat. Set ${v} in your environment.`,
            );
          }
        }
      }
      break;
    }

    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${provider}. Supported: local, s3, s3-compat.`);
  }

  // IMAGE_TRANSFORM_PROVIDER (D-12 default sharp). Phase 24 has no required
  // env keys for either provider — Phase 28 may add them after the spike.
  const imgProvider = process.env.IMAGE_TRANSFORM_PROVIDER ?? "sharp";
  if (imgProvider !== "sharp" && imgProvider !== "imagescript") {
    throw new Error(
      `Unknown IMAGE_TRANSFORM_PROVIDER: ${imgProvider}. Supported: sharp, imagescript.`,
    );
  }
}
