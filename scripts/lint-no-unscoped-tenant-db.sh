#!/usr/bin/env bash
# scripts/lint-no-unscoped-tenant-db.sh (v1.5 authz hardening — tenant isolation)
#
# Guards tenant isolation at the request-handler boundary. A per-request module
# handler (commands/ or queries/) should take its tenant-scoped db from
# HandlerContext (`ctx.db`, a ScopedDb that auto-applies WHERE tenant_id = …)
# rather than reaching around it via:
#   - `.db.raw`          — the ScopedDb escape hatch (no tenant filter), or
#   - getDb( / createDb( — a fresh, unscoped connection.
#
# Cross-tenant access that is INTENTIONAL — platform-operator/admin functions, or
# the files module's manual `ctx.tenantId` scoping (it predates ScopedDb) — must
# declare itself with a `// scoped-db-allow: <reason>` comment on the SAME line.
# That makes every bypass explicit and reviewable; a NEW, un-annotated bypass
# fails the gate (a ratchet, not a rewrite).
#
# Scope: packages/modules/*/src/{commands,queries} only. jobs/, hooks/, health/,
# and subscribers run in worker/system context (legitimately cross-tenant) and
# are out of scope. apps/api (the composition root) is never scanned.
#
# Mirrors scripts/lint-no-cross-module-imports.sh: set -euo pipefail + grep shape
# + exit codes. Exit 0 when clean; exit 1 with a listing on violation.

set -euo pipefail

PATTERN='\.db\.raw\b|getDb\(|createDb\('

MATCHES=$(grep -rnE "$PATTERN" \
  packages/modules/*/src/commands packages/modules/*/src/queries \
  --include="*.ts" 2>/dev/null \
  | grep -v 'scoped-db-allow' \
  | grep -vE '__tests__|__integration__|__unit__' || true)

if [ -z "$MATCHES" ]; then
  exit 0
fi

echo "ERROR: Unscoped tenant DB access in a request handler (v1.5 tenant-isolation gate)."
echo "Prefer ctx.db (ScopedDb) — it auto-filters tenant_id. If the cross-tenant access is"
echo "intentional (operator/admin op, or manual ctx.tenantId scoping), append on that line:"
echo "    // scoped-db-allow: <why this is safe>"
echo
echo "Matches:"
echo "$MATCHES"
exit 1
