#!/usr/bin/env bash
# scripts/lint-no-cross-module-imports.sh (Phase 26 / SC#5 / MOD-02)
#
# Bans direct module->module imports. One feature module MUST NOT import another
# feature module via a package import (`from "@baseworks/module-..."`). The
# sanctioned cross-module channel is TypedEventBus (ctx.emit / eventBus.on).
#
# Infra packages (@baseworks/shared, @baseworks/db, @baseworks/storage,
# @baseworks/config, @baseworks/observability, @baseworks/queue, @baseworks/i18n)
# do NOT match the banned `@baseworks/module-` prefix and are therefore allowed
# automatically — no allow-list needed.
#
# Scope: packages/modules/*/src only. apps/api (the composition root) is
# intentionally NOT scanned — it is permitted to import any module.
#
# Mirrors scripts/lint-no-direct-files-access.sh: set -euo pipefail + grep shape
# + exit codes. This is a shell-only gate (Biome 2.x GritQL plugins lack an
# import-graph / path-allowlist primitive, consistent with the files-access gate).
#
# Exit 0 when clean; exit 1 with a listing on violation.

set -euo pipefail

# from "@baseworks/module-..." or from '@baseworks/module-...'
PATTERN='from[[:space:]]+["'\'']@baseworks/module-'

MATCHES=$(grep -rnE "$PATTERN" packages/modules/*/src --include="*.ts" --include="*.tsx" 2>/dev/null || true)
if [ -z "$MATCHES" ]; then
  exit 0
fi

echo "ERROR: Cross-module import is banned (Phase 26 / SC#5). Use TypedEventBus (ctx.emit / eventBus.on). Matches:"
echo "$MATCHES"
exit 1
