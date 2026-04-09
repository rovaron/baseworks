import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  defaultLocale,
  locales,
  namespaces,
  enCommon,
  enAuth,
  enDashboard,
  enBilling,
  enAdmin,
  ptBRCommon,
  ptBRAuth,
  ptBRDashboard,
  ptBRBilling,
  ptBRAdmin,
} from "@baseworks/i18n";

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    billing: enBilling,
    admin: enAdmin,
  },
  "pt-BR": {
    common: ptBRCommon,
    auth: ptBRAuth,
    dashboard: ptBRDashboard,
    billing: ptBRBilling,
    admin: ptBRAdmin,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  supportedLngs: [...locales],
  ns: [...namespaces],
  defaultNS: "common",
  interpolation: {
    escapeValue: false, // React already escapes
    prefix: "{",
    suffix: "}",
  },
});

export default i18n;
