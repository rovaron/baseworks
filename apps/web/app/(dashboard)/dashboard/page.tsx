"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@baseworks/ui";
import { useTenant } from "@/components/tenant-provider";
import { useTranslations } from "next-intl";

export default function DashboardPage() {
  const { activeTenant, isLoading } = useTenant();
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");

  const tenantName = activeTenant?.name ?? t("defaultTenantName");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <div aria-busy={isLoading} aria-live="polite">
        {isLoading ? (
          <Card>
            <CardHeader>
              <CardTitle>{tc("loading")}</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="sr-only">{tc("loading")}</span>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("welcome", { tenantName })}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {t("welcomeDescription")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
