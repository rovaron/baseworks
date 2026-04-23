#!/usr/bin/env bash
# scripts/lint-no-enterwith.sh (Phase 19 / Plan 19-08 / D-25)
#
# Belt-and-suspenders gate for CTX-01 AsyncLocalStorage.enterWith ban.
# Runs alongside the Biome GritQL plugin at .biome/plugins/no-als-enter-with.grit.
#
# The GritQL plugin is the primary gate; this grep script is a second line of
# defense that catches any `.enterWith(` slip-through in case a file escapes
# biome check's scope (generated fixtures, vendored code, etc.) — and is
# independent of Biome's version / schema / plugin-loader status.
#
# Exit 0 when the repo is clean (allow-list entries excluded); exit 1 with
# a listing on violation.

set -euo pipefail

# Allow-list: the B5 red-path fixture is intentionally seeded with .enterWith(
# so Biome's GritQL rule can be exercised by the test at
# scripts/__tests__/enterwith-ban.test.ts. The grep gate MUST ignore this
# single file. If a future justified exception arises, add the path here AND
# document the rationale in the commit message + SUMMARY note.
ALLOWLIST=(
  "packages/observability/src/__tests__/__fixtures__/enterwith-violation.ts"
)

MATCHES=$(grep -rn "\.enterWith(" packages/ apps/ --include="*.ts" --include="*.tsx" 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  exit 0
fi

if [ ${#ALLOWLIST[@]} -gt 0 ]; then
  for allowed in "${ALLOWLIST[@]}"; do
    MATCHES=$(echo "$MATCHES" | grep -v "$allowed" || true)
  done
fi

if [ -z "$MATCHES" ]; then
  exit 0
fi

echo "ERROR: AsyncLocalStorage.enterWith is banned (CTX-01). Matches:"
echo "$MATCHES"
exit 1
