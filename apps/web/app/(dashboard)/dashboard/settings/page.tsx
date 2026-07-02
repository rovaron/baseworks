"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@baseworks/ui";
import { useTranslations } from "next-intl";
import { useQueryState } from "nuqs";
import { Suspense } from "react";
import { InviteDialog } from "@/components/invite-dialog";
import { MembersList } from "@/components/members-list";
import { NotificationPreferences } from "@/components/notification-preferences";
import { PendingInvitations } from "@/components/pending-invitations";
import { useTenant } from "@/components/tenant-provider";

function SettingsContent() {
  const [tab, setTab] = useQueryState("tab", { defaultValue: "team" });
  const t = useTranslations("invite");
  const tn = useTranslations("notifications");
  const { activeTenant } = useTenant();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <Tabs value={tab ?? "team"} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="team">{t("settings.tabs.team")}</TabsTrigger>
          <TabsTrigger value="notifications">{tn("preferences.tabLabel")}</TabsTrigger>
        </TabsList>
        <TabsContent value="team" className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t("members.title")}</h2>
              <InviteDialog orgId={activeTenant?.id} orgName={activeTenant?.name} />
            </div>
            <MembersList />
          </div>
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">{t("pending.title")}</h2>
            <PendingInvitations />
          </div>
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationPreferences />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  );
}
