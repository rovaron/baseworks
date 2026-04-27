// This file reads `process.env` directly — do NOT import the config package here.
// Mirrors packages/observability/src/factory.ts:16 header note: instance-id
// resolution must work at module-import time before the config schema is built.
import os from "node:os";

/**
 * Phase 22 / EXT-02 / D-12 — resolve a stable instance ID for heartbeat publishing.
 *
 * Resolution order:
 *   1. process.env.INSTANCE_ID  (k8s/docker explicit override)
 *   2. process.env.HOSTNAME      (k8s pod name / docker default)
 *   3. os.hostname()             (bare-metal fallback)
 */
export function resolveInstanceId(): string {
  return process.env.INSTANCE_ID ?? process.env.HOSTNAME ?? os.hostname();
}
