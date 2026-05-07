#!/usr/bin/env bash
# scripts/lint-no-direct-files-access.sh (Phase 24 / Plan 24-07 / D-17)
#
# Belt-and-suspenders gate for the no-direct-files-table-access ban.
# Runs alongside the Biome GritQL plugin at .biome/plugins/ban-files-table-access.grit.
#
# The GritQL plugin is the primary gate; this grep script is a second line of
# defense that catches any `db.select(...).from(files)` slip-through in case
# a file escapes biome check's scope (generated fixtures, vendored code,
# pre-existing biome-ignore comments) — and is independent of Biome's version /
# schema / plugin-loader status. Per PATTERNS section "Important path note",
# it is also the authoritative path-allowlist mechanism (Biome 2.4.10's
# GritQL plugins lack a built-in path-allowlist primitive).
#
# Exit 0 when the repo is clean (allow-list entries excluded); exit 1 with
# a listing on violation.

set -euo pipefail

# Allow-list: the packages/modules/files/** path is the sanctioned consumer
# (Phase 26 creates it; pre-allow-listed here so Phase 26's first task does
# not break lint). The red-path fixture is the test seed.
# If a future justified exception arises, add the path here AND document
# the rationale in the commit message + SUMMARY note (mirrors the
# no-als-enter-with allow-list discipline).
ALLOWLIST=(
  "packages/modules/files/"
  "scripts/__tests__/__fixtures__/direct-files-access-violation.ts"
)

# Pattern: db.select(...).from(files). Use a permissive grep that catches the
# banned shape without false-positiving on `from(filesXyz)` or `from(myFiles)`.
# We require the literal `from(files)` token (closing paren immediately after
# the bare identifier `files`).
PATTERN='\.select\(.*\)\.from\(files\)'

MATCHES=$(grep -rnE "$PATTERN" packages/ apps/ --include="*.ts" --include="*.tsx" 2>/dev/null || true)
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

echo "ERROR: Direct db.select().from(files) is banned (Phase 24 / D-17). Matches:"
echo "$MATCHES"
exit 1
