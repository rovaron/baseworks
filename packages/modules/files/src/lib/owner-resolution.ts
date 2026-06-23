/**
 * Phase 31 / OPS-02 — SAFE owner-existence resolution for the orphan reaper.
 *
 * The reaper (`cleanup-reap-orphan-files`) is the BACKSTOP for files whose
 * `onDelete:"cascade"` event was lost. It MUST NEVER delete a file whose owner
 * still exists and MUST SKIP whenever owner-existence cannot be proven gone.
 *
 * Dispatch: recover the `FileRelation` for a file's `(ownerModule, recordType)`
 * via the shared `fileRelationsRegistry` (NOT a cross-module package import) and
 * call its opt-in `ownerExists` resolver. Each owning module's resolver reads its
 * OWN tables from the shared `@baseworks/db` schema.
 *
 * Safety contract — `resolve()` returns:
 *   - `false`     → owner DEFINITIVELY gone (query succeeded, zero rows) ⇒ caller MAY reap.
 *   - `true`      → owner alive ⇒ caller SKIPS.
 *   - `"unknown"` → no relation found, no resolver declared, or the resolver
 *                   threw / returned `"unknown"` ⇒ caller SKIPS.
 * The reaper reaps ONLY on a definitive `false`; every other branch is SKIP.
 *
 * Memoized per `(ownerModule, recordType, tenantId, recordId)` within one run so
 * N files of one owner cost ONE existence query.
 */

import { findRelationByRecordType } from "./relation-lookup";

export type OwnerExistence = boolean | "unknown";

export interface OwnerResolveArgs {
  ownerModule: string;
  recordType: string;
  tenantId: string;
  recordId: string;
}

export interface OwnerResolver {
  resolve(args: OwnerResolveArgs): Promise<OwnerExistence>;
}

/**
 * Build a per-run resolver with an internal memo cache. `fileRelationsRegistry`
 * is read lazily on each call (it is the process-wide singleton populated at
 * boot, or seeded directly in tests).
 */
export function createOwnerResolver(): OwnerResolver {
  const memo = new Map<string, Promise<OwnerExistence>>();

  return {
    resolve(args: OwnerResolveArgs): Promise<OwnerExistence> {
      const key = `${args.ownerModule}:${args.recordType}:${args.tenantId}:${args.recordId}`;
      const existing = memo.get(key);
      if (existing) return existing;

      const promise = (async (): Promise<OwnerExistence> => {
        const relation = findRelationByRecordType(args.ownerModule, args.recordType);
        // No relation in code (removed) OR resolver not declared ⇒ SKIP.
        if (!relation || !relation.ownerExists) return "unknown";
        try {
          return await relation.ownerExists({
            tenantId: args.tenantId,
            recordId: args.recordId,
          });
        } catch {
          // Query failed ⇒ indeterminate ⇒ SKIP (never reap on an error).
          return "unknown";
        }
      })();

      memo.set(key, promise);
      return promise;
    },
  };
}
