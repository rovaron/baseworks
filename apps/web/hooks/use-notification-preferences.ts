// apps/web/hooks/use-notification-preferences.ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useTenant } from "@/components/tenant-provider";
import {
  fetchPreferences,
  type NotificationPreference,
  savePreferences,
} from "@/lib/notifications-api";

const KEY = "notification-preferences";

export function useNotificationPreferences() {
  const { activeTenant } = useTenant();
  const tenantId = activeTenant?.id;
  const qc = useQueryClient();
  const t = useTranslations("notifications");
  const tc = useTranslations("common");

  const query = useQuery({
    queryKey: [KEY, tenantId],
    queryFn: () => fetchPreferences(),
    enabled: !!tenantId,
  });

  const setM = useMutation({
    mutationFn: (prefs: Array<{ category: string; channel: "email"; enabled: boolean }>) =>
      savePreferences(prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: [KEY] });
      const prev = qc.getQueryData<NotificationPreference[]>([KEY, tenantId]);
      if (prev) {
        const next = new Map(prefs.map((p) => [p.category, p.enabled]));
        qc.setQueryData<NotificationPreference[]>(
          [KEY, tenantId],
          prev.map((p) => (next.has(p.category) ? { ...p, email: next.get(p.category)! } : p)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, context) => {
      if (context?.prev) qc.setQueryData([KEY, tenantId], context.prev);
      toast.error(tc("error"));
    },
    onSuccess: () => toast.success(t("preferences.saved")),
    onSettled: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });

  return {
    preferences: (query.data ?? []) as NotificationPreference[],
    isLoading: query.isPending && !!tenantId,
    isError: query.isError,
    setEmail: (category: string, enabled: boolean) =>
      setM.mutateAsync([{ category, channel: "email", enabled }]),
  };
}
