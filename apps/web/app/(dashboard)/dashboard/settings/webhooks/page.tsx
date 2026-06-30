// apps/web/app/(dashboard)/dashboard/settings/webhooks/page.tsx
import { getTranslations } from "next-intl/server";
import { WebhooksManager } from "@/components/webhooks/webhooks-manager";

export default async function WebhooksSettingsPage() {
  const t = await getTranslations("notifications");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("webhooks.title")}</h1>
      <WebhooksManager />
    </div>
  );
}
