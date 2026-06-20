import { type Static, Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

/**
 * Payload schema for the example follow-up job.
 *
 * Compiled once at module load (mirrors `defineCommand`/`defineQuery`) so
 * each invocation only pays the cheap `Check()` cost. A genuinely malformed
 * payload throws below, which lets BullMQ retry and ultimately dead-letter
 * the job rather than silently no-op on bad data.
 */
const FollowupPayloadSchema = Type.Object({
  exampleId: Type.String({ minLength: 1 }),
  tenantId: Type.String({ minLength: 1 }),
});
const followupPayloadChecker = TypeCompiler.Compile(FollowupPayloadSchema);
type FollowupPayload = Static<typeof FollowupPayloadSchema>;

/**
 * Process a follow-up job for a newly created example record.
 *
 * Runs in the BullMQ worker process after `example.created` is emitted
 * by `createExample` and picked up by `registerExampleHooks`. Demonstrates
 * the job-handler surface of a module for the Phase 15 "Add a Module"
 * tutorial (DOCS-03): it validates its untrusted payload, then logs.
 *
 * Thrown errors are treated as transient failures and trigger BullMQ's
 * default retry policy (3 attempts with exponential backoff starting at
 * 1000 ms; see `packages/queue/src/index.ts:22-27`).
 *
 * @param data - Job payload: `{ exampleId: string, tenantId: string }`.
 * @returns Resolves with no value on success.
 */
export async function processFollowup(data: unknown): Promise<void> {
  // Validate the untrusted BullMQ payload up front. Throwing on a bad shape
  // lets BullMQ retry and eventually dead-letter the job instead of acting
  // on garbage data (an unchecked `as` cast would hide the corruption).
  if (!followupPayloadChecker.Check(data)) {
    const message = [...followupPayloadChecker.Errors(data)]
      .map((e) => `${e.path}: ${e.message}`)
      .join(", ");
    throw new Error(`[example-process-followup] invalid payload: ${message}`);
  }
  const payload: FollowupPayload = data;

  // Minimal demo handler: validate the untrusted payload (above) then log.
  // A richer handler would build a tenant-scoped db from payload.tenantId
  // (scopedDb(getDb(), payload.tenantId)) and do follow-up work, but the
  // tutorial keeps this log-only so it runs without a live DB in tests.
  // biome-ignore lint/suspicious/noConsole: demo handler; worker runtime has no shared logger in this package
  console.log(
    `[example-process-followup] tenantId=${payload.tenantId} exampleId=${payload.exampleId}`,
  );
}
