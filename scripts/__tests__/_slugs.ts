/**
 * scripts/__tests__/_slugs.ts (Phase 23 / Plan 23-01 / Task 3)
 *
 * Single source of truth for the 9 runbook + alert slugs across the
 * Wave-0 doc-shape RED tests. The runbook list and the alert list are
 * structurally identical (D-14 — every runbook gets a paired Sentry alert
 * template, kebab-case slug shared 1:1).
 *
 * Plan 23-03 (runbooks) and Plan 23-04 (alerts) MUST use these exact strings.
 * The acceptance gate for those plans is "every slug in this list maps to
 * exactly one file under docs/runbooks/<slug>.md and one under
 * docs/alerts/sentry/<slug>.json".
 */
export const RUNBOOK_SLUGS = [
  "db-down",
  "redis-down",
  "queue-backing-up",
  "webhook-failures",
  "auth-outage",
  "otel-exporter-failing",
  "bull-board-inaccessible",
  "high-error-rate",
  "slow-checkout",
] as const;

export type RunbookSlug = (typeof RUNBOOK_SLUGS)[number];

// Alert slugs mirror runbook slugs 1:1 per D-14.
export const ALERT_SLUGS = RUNBOOK_SLUGS;
export type AlertSlug = RunbookSlug;
