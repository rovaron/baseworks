// Fixture file for the B5 red-path test in scripts/__tests__/enterwith-ban.test.ts.
// Intentionally contains `.enterWith(` to prove the Biome GritQL rule at
// .biome/plugins/no-als-enter-with.grit actually fires (not merely registered).
//
// Allow-listed in scripts/lint-no-enterwith.sh so the grep gate ignores it.
// DO NOT import this file from production code.
//
// The B5 test runs `bunx biome check <this-file>` and asserts:
//   (a) Biome exits non-zero,
//   (b) output contains the rule id `no-async-local-storage-enterWith`,
//   (c) output contains the message marker `AsyncLocalStorage.enterWith is banned (CTX-01)`.
// biome-ignore-all: fixture file — we WANT the rule to fire when targeted.

import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage<{ x: number }>();
als.enterWith({ x: 1 });
