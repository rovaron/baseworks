#!/usr/bin/env bash
# scripts/lint-rls-coverage.sh (v1.5 tenant isolation — RLS coverage ratchet)
#
# Every tenant-scoped table (one whose columns include `tenantIdColumn()`) MUST
# also declare a row-level-security policy via `tenantRlsPolicy(...)`, or the new
# table silently ships without DB-level tenant isolation. This guard fails if a
# schema file defines more tenant columns than RLS policies.
#
# A file may opt a table out with an inline `// rls-allow: <reason>` comment
# (e.g. a table that is tenant-scoped but intentionally not RLS-protected).
#
# Scope: packages/db/src/schema/*.ts, excluding base.ts (the tenantIdColumn
# helper definition) and rls.ts (the tenantRlsPolicy helper definition). Auth/org
# tables live in auth.ts and do NOT use tenantIdColumn(), so they never match.
#
# Mirrors the other lint-no-* gates: set -euo pipefail + grep + exit codes.

set -euo pipefail

violations=""
for f in packages/db/src/schema/*.ts; do
  case "$f" in
    */base.ts | */rls.ts) continue ;;
  esac
  # Count actual tenant-column definitions: `tenantId: tenantIdColumn()` and
  # `tenantId: tenantIdColumn().primaryKey()` both match `: tenantIdColumn()`.
  # The leading `:` avoids matching prose like auth.ts's "do NOT have
  # tenantIdColumn()." (which has no colon before the call).
  tcols=$(grep -cE ':[[:space:]]*tenantIdColumn\(\)' "$f" || true)
  pols=$(grep -cE 'tenantRlsPolicy\(' "$f" || true)
  if [ "$tcols" -gt 0 ] && [ "$pols" -lt "$tcols" ] && ! grep -q 'rls-allow' "$f"; then
    violations="${violations}${f}: ${tcols} tenant table(s) but only ${pols} RLS policy(ies)\n"
  fi
done

if [ -z "$violations" ]; then
  exit 0
fi

echo "ERROR: tenant table(s) without an RLS policy (v1.5 tenant-isolation coverage gate)."
echo "Every table using tenantIdColumn() must also declare tenantRlsPolicy(\"<table>_tenant_isolation\", t.tenantId)"
echo "in its pgTable extra-config array (see docs/integrations/tenant-isolation.md). To intentionally"
echo "opt out, add an inline '// rls-allow: <reason>' comment in the file."
echo
printf "%b" "$violations"
exit 1
