export const defaultLocale = "en" as const;
export const locales = ["en", "pt-BR"] as const;
export type Locale = (typeof locales)[number];

export const namespaces = ["common", "auth", "dashboard", "billing", "admin", "invite"] as const;
export type Namespace = (typeof namespaces)[number];

// Re-export all English translations (used as type source and fallback)
export { default as enCommon } from "./locales/en/common.json";
export { default as enAuth } from "./locales/en/auth.json";
export { default as enDashboard } from "./locales/en/dashboard.json";
export { default as enBilling } from "./locales/en/billing.json";
export { default as enAdmin } from "./locales/en/admin.json";
export { default as enInvite } from "./locales/en/invite.json";

// Re-export all Portuguese translations
export { default as ptBRCommon } from "./locales/pt-BR/common.json";
export { default as ptBRAuth } from "./locales/pt-BR/auth.json";
export { default as ptBRDashboard } from "./locales/pt-BR/dashboard.json";
export { default as ptBRBilling } from "./locales/pt-BR/billing.json";
export { default as ptBRAdmin } from "./locales/pt-BR/admin.json";
export { default as ptBRInvite } from "./locales/pt-BR/invite.json";

/**
 * Load all messages for a given locale, merged by namespace.
 * Used by next-intl's getMessages and react-i18next initialization.
 */
export async function getMessages(locale: Locale): Promise<Record<string, Record<string, unknown>>> {
  const messages: Record<string, Record<string, unknown>> = {};
  for (const ns of namespaces) {
    const mod = await import(`./locales/${locale}/${ns}.json`);
    messages[ns] = mod.default;
  }
  return messages;
}

/**
 * Replace {variable} tokens in a template string.
 *
 * Uses the same {/} delimiters as next-intl (defaults) and the react-i18next
 * config at apps/admin/src/lib/i18n.ts:45-46. Unknown tokens are preserved
 * in place (no throw) so partial interpolation is safe.
 *
 * @example
 *   interpolate("You're invited to {orgName}", { orgName: "Acme" })
 *   // => "You're invited to Acme"
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in vars ? String(vars[key]) : match;
  });
}
