export const defaultLocale = "en" as const;
export const locales = ["en", "pt-BR"] as const;
export type Locale = (typeof locales)[number];

export const namespaces = ["common", "auth", "dashboard", "billing", "admin"] as const;
export type Namespace = (typeof namespaces)[number];

// Re-export all English translations (used as type source and fallback)
export { default as enCommon } from "./locales/en/common.json";
export { default as enAuth } from "./locales/en/auth.json";
export { default as enDashboard } from "./locales/en/dashboard.json";
export { default as enBilling } from "./locales/en/billing.json";
export { default as enAdmin } from "./locales/en/admin.json";

// Re-export all Portuguese translations
export { default as ptBRCommon } from "./locales/pt-BR/common.json";
export { default as ptBRAuth } from "./locales/pt-BR/auth.json";
export { default as ptBRDashboard } from "./locales/pt-BR/dashboard.json";
export { default as ptBRBilling } from "./locales/pt-BR/billing.json";
export { default as ptBRAdmin } from "./locales/pt-BR/admin.json";

/**
 * Load all messages for a given locale, merged by namespace.
 * Used by next-intl's getMessages and react-i18next initialization.
 */
export async function getMessages(locale: Locale) {
  const messages: Record<string, Record<string, string>> = {};
  for (const ns of namespaces) {
    const mod = await import(`./locales/${locale}/${ns}.json`);
    messages[ns] = mod.default;
  }
  return messages;
}
