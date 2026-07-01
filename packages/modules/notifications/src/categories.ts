// packages/modules/notifications/src/categories.ts

/**
 * The category key set — the ONE place category keys are declared. Kept a
 * compile-time union so a catalog entry's `category` field is type-checked. To
 * add a genuinely new category (rare), add its key here and register its def.
 */
export type Category = "system" | "team" | "billing" | "files" | "security";

export interface CategoryDef {
  /** Default English label; the web UI prefers its own i18n key, falls back to this. */
  label: string;
  /** false = always-on: the UI locks the toggle and setPreferences rejects opting out. */
  mutable: boolean;
}

const registry = new Map<Category, CategoryDef>();

/**
 * Register (or override) a category's def. The key is compile-time-checked, so a
 * typo can't slip in. Idempotent (safe under per-suite test re-import). Other
 * modules may call this at boot to own their category's label/mutability.
 */
export function registerCategory(key: Category, def: CategoryDef): void {
  registry.set(key, def);
}

/** The def for a category key, or undefined if not registered. */
export function getCategory(key: Category): CategoryDef | undefined {
  return registry.get(key);
}

/**
 * All registered categories in registration order — the source of truth the
 * preferences API/UI iterate over.
 */
export function getCategories(): Array<{ key: Category } & CategoryDef> {
  return [...registry.entries()].map(([key, def]) => ({ key, ...def }));
}

// Built-in taxonomy owned by the notifications module. Seeded at module load,
// UNCONDITIONALLY (not inside the REDIS_URL-gated runtime) — preferences must
// work without Redis.
registerCategory("system", { label: "System", mutable: true });
registerCategory("team", { label: "Team", mutable: true });
registerCategory("billing", { label: "Billing", mutable: true });
registerCategory("files", { label: "Files", mutable: true });
registerCategory("security", { label: "Security", mutable: false });
