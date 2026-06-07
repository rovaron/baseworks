import {
  defaultLocale,
  enAdmin,
  enAuth,
  enBilling,
  enCommon,
  enDashboard,
  enInvite,
  locales,
  namespaces,
  ptBRAdmin,
  ptBRAuth,
  ptBRBilling,
  ptBRCommon,
  ptBRDashboard,
  ptBRInvite,
} from "@baseworks/i18n";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    billing: enBilling,
    admin: enAdmin,
    invite: enInvite,
  },
  "pt-BR": {
    common: ptBRCommon,
    auth: ptBRAuth,
    dashboard: ptBRDashboard,
    billing: ptBRBilling,
    admin: ptBRAdmin,
    invite: ptBRInvite,
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
