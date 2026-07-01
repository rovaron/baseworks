// packages/modules/notifications/src/lib/preferences.ts

/**
 * Preference rows are stored per (user, category, channel). Email is the only
 * channel wired today; the constant keeps push/sms extension one edit away.
 */
export const PREFERENCE_CHANNELS = ["email"] as const;
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

/**
 * From opt-out rows for a single (category, channel), the set of muted user ids.
 * Only rows with `enabled === false` mute; an absent row means "not muted".
 */
export function mutedUserSet(optOutRows: Array<{ userId: string; enabled: boolean }>): Set<string> {
  return new Set(optOutRows.filter((r) => !r.enabled).map((r) => r.userId));
}
