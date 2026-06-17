import type { FileRelation, ModuleDefinition } from "@baseworks/shared";
import { z } from "zod";

/**
 * fileRelationsRegistry (Phase 24 / FILE-01 / MOD-01 / D-06..D-09).
 *
 * Process-wide singleton collected at boot by ModuleRegistry.loadAll() (Plan 24-06).
 * Keyed by `${ownerModule}:${kind}` per D-08 — two distinct modules can declare
 * the same `kind` (e.g., both `user`) without collision.
 *
 * Zod validation (D-07) runs on every register() call. Invalid shapes throw
 * with the offending module + kind + Zod error message — fails boot LOUD,
 * mirroring CQRS/better-auth validation patterns. A typo in a module's
 * fileRelations declaration cannot reach Phase 26's sign-upload contract
 * silently.
 *
 * `FileRelation` and `ImageVariantSpec` are imported from `@baseworks/shared`
 * (canonical home — see Plan 24-03 type-ownership decision).
 */

const imageVariantSpecSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive().optional(),
  format: z.enum(["webp", "jpeg", "png"]),
  quality: z.number().int().min(1).max(100).optional(),
});

const fileRelationSchema = z.object({
  recordType: z.string().min(1),
  allowedMimeTypes: z.array(z.string().min(1)).min(1),
  maxByteSize: z.number().int().positive(),
  generateVariants: z.array(imageVariantSpecSchema).optional(),
  onDelete: z.enum(["cascade", "orphan"]).optional(),
  // Phase 29 / IDA-01 — cardinality; z.object strips unknown keys, so this MUST
  // be declared or `register()` would drop it and the cascade-on-replace
  // (attach-file, cardinality:"single") would never fire.
  cardinality: z.enum(["single", "many"]).optional(),
  // Hooks are functions — Zod can't enforce arity at runtime cheaply.
  canRead: z.any().optional(),
  canWrite: z.any().optional(),
});

class FileRelationsRegistry {
  private byKey = new Map<string, FileRelation>();

  /**
   * Register a FileRelation under `${ownerModule}:${kind}`. Validates shape
   * via Zod; throws with module + kind context on invalid relation.
   */
  register(ownerModule: string, kind: string, relation: FileRelation): void {
    const parsed = fileRelationSchema.safeParse(relation);
    if (!parsed.success) {
      throw new Error(
        `Invalid FileRelation for module="${ownerModule}" kind="${kind}": ${parsed.error.message}`,
      );
    }
    this.byKey.set(`${ownerModule}:${kind}`, parsed.data as FileRelation);
  }

  /** Look up a relation by (ownerModule, kind). Returns undefined if not registered. */
  get(ownerModule: string, kind: string): FileRelation | undefined {
    return this.byKey.get(`${ownerModule}:${kind}`);
  }

  /** Read-only snapshot of all registered relations. Key format: `${ownerModule}:${kind}`. */
  getAll(): ReadonlyMap<string, FileRelation> {
    return this.byKey;
  }

  /** Empty the registry — used by tests for isolation. */
  reset(): void {
    this.byKey.clear();
  }
}

/** Process-wide singleton (D-06). Collected by ModuleRegistry.loadAll() per D-09. */
export const fileRelationsRegistry = new FileRelationsRegistry();

/**
 * collectFileRelations(modules) — walk an iterable of [moduleName, ModuleDefinition]
 * and register every `def.fileRelations[kind]` into the registry.
 *
 * Modules without `def.fileRelations` are skipped silently (it's optional).
 * Invalid relation shapes propagate the underlying register() error, which
 * names module + kind for fast diagnosis.
 *
 * Per D-09, `ModuleRegistry.loadAll()` calls this immediately after the
 * existing `def.health` collection block in apps/api/src/core/registry.ts.
 */
export function collectFileRelations(modules: Iterable<[string, ModuleDefinition]>): void {
  for (const [moduleName, def] of modules) {
    if (!def.fileRelations) continue;
    for (const [kind, relation] of Object.entries(def.fileRelations)) {
      fileRelationsRegistry.register(moduleName, kind, relation);
    }
  }
}
