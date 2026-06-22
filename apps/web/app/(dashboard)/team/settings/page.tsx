// Phase 29 / IDA-02 — /team/settings route. Server shell → client
// <OrgLogoUploader> (owner/admin-gated on the client; server canWrite is the
// authority).

import { getTranslations } from "next-intl/server";
import { OrgLogoUploader } from "@/components/org-logo-uploader";
import { RolesManager } from "@/components/roles-manager";

export default async function TeamSettingsPage() {
  const t = await getTranslations("files");
  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t("logo.title")}</h1>
      <OrgLogoUploader />
      <RolesManager />
    </div>
  );
}
