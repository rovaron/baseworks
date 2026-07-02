// apps/web/components/notification-preferences.tsx
"use client";
import { Label, Skeleton, Switch } from "@baseworks/ui";
import { useTranslations } from "next-intl";
import { useNotificationPreferences } from "@/hooks/use-notification-preferences";

export function NotificationPreferences() {
  const t = useTranslations("notifications");
  const { preferences, isLoading, isError, setEmail } = useNotificationPreferences();

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <p className="text-sm text-destructive">{t("preferences.loadError")}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">{t("preferences.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("preferences.description")}</p>
      </div>
      <ul className="divide-y rounded-md border">
        {preferences.map((p) => (
          <li key={p.category} className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor={`pref-${p.category}`}>
                {t(`preferences.categories.${p.category}`)}
              </Label>
              {!p.mutable && (
                <p className="text-xs text-muted-foreground">{t("preferences.alwaysOn")}</p>
              )}
            </div>
            <Switch
              id={`pref-${p.category}`}
              checked={p.email}
              disabled={!p.mutable}
              onCheckedChange={(v) => setEmail(p.category, v)}
              aria-label={t(`preferences.categories.${p.category}`)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
