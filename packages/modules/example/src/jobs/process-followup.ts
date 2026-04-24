/**
 * Process a follow-up job for a newly created example record.
 *
 * Runs in the BullMQ worker process after `example.created` is emitted
 * by `createExample` and picked up by `registerExampleHooks`. Demonstrates
 * the job-handler surface of a module for the Phase 15 "Add a Module"
 * tutorial (DOCS-03). The handler logs the example identifier and tenant
 * context, then resolves.
 *
 * Thrown errors are treated as transient failures and trigger BullMQ's
 * default retry policy (3 attempts with exponential backoff starting at
 * 1000 ms; see `packages/queue/src/index.ts:22-27`).
 *
 * @param data - Job payload: `{ exampleId: string, tenantId: string }`.
 * @returns Resolves with no value on success.
 */
export async function processFollowup(data: unknown): Promise<void> {
  const payload = data as { exampleId: string; tenantId: string };

  // Minimal demo handler per Phase 15 RESEARCH Open Question 1 recommendation:
  // log and no-op. A richer demo (e.g., update a processed_at column) is
  // deferred to keep the tutorial focused on module wiring, not business logic.
  // biome-ignore lint/suspicious/noConsole: demo handler; worker runtime has no shared logger in this package
  console.log(
    `[example-process-followup] tenantId=${payload.tenantId} exampleId=${payload.exampleId}`,
  );
}
