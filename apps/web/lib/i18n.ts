import { defaultLocale, getMessages, type Locale } from "@baseworks/i18n";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  // For now, use default locale. Locale switching will be added when I18N-05 is implemented.
  const locale: Locale = defaultLocale;
  const messages = await getMessages(locale);

  return {
    locale,
    messages,
  };
});
