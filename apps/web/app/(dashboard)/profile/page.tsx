// Phase 29 / IDA-01 — /profile route. Server shell → client <AvatarUploader>.

import { getTranslations } from "next-intl/server";
import { AvatarUploader } from "@/components/avatar-uploader";

export default async function ProfilePage() {
  const t = await getTranslations("files");
  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t("avatar.title")}</h1>
      <AvatarUploader />
    </div>
  );
}
