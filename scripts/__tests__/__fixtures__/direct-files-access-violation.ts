// Phase 24 / Plan 24-07 / D-17 — RED-PATH FIXTURE for the
// no-direct-files-table-access rule.
//
// This file is INTENTIONALLY non-conformant. The Biome GritQL rule at
// .biome/plugins/ban-files-table-access.grit must fire on the line below.
// The shell-grep gate at scripts/lint-no-direct-files-access.sh ALLOWLIST
// excludes this exact path so `bun run lint` stays green on a clean repo
// while still exercising the rule via scripts/__tests__/files-access-ban.test.ts.
//
// DO NOT REMOVE OR FIX THIS FILE without coordinating with the test above.
// DO NOT import this file from production code.

// biome-ignore-all lint/suspicious/noExplicitAny: red-path fixture
// biome-ignore-all lint/correctness/noUnusedVariables: red-path fixture
declare const db: { select: (cols: any) => { from: (table: any) => any } };
declare const files: any;

// Banned pattern — must trigger no-direct-files-table-access:
export const violation = db.select({ id: 1 }).from(files);
