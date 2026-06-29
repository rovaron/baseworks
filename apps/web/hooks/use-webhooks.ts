// apps/web/hooks/use-webhooks.ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useTenant } from "@/components/tenant-provider";
import {
  type CreateWebhookInput,
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  redeliverWebhook,
  rotateWebhookSecret,
  type UpdateWebhookInput,
  updateWebhook,
  type WebhookEndpoint,
} from "@/lib/webhooks-api";

export function useWebhooks() {
  const { activeTenant } = useTenant();
  const tenantId = activeTenant?.id;
  const qc = useQueryClient();
  const t = useTranslations("notifications");
  const tc = useTranslations("common");

  const query = useQuery({
    queryKey: ["webhooks", tenantId],
    queryFn: () => listWebhooks(),
    enabled: !!tenantId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["webhooks"] });

  const createM = useMutation({
    mutationFn: (input: CreateWebhookInput) => createWebhook(input),
    onSuccess: () => {
      toast.success(t("webhooks.created"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });
  const updateM = useMutation({
    mutationFn: (args: { id: string; input: UpdateWebhookInput }) =>
      updateWebhook(args.id, args.input),
    onSuccess: () => {
      toast.success(t("webhooks.updated"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteWebhook(id),
    onSuccess: () => {
      toast.success(t("webhooks.deleted"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });
  const rotateM = useMutation({
    mutationFn: (id: string) => rotateWebhookSecret(id),
    onSuccess: () => {
      toast.success(t("webhooks.secretRotated"));
      invalidate();
    },
    onError: () => toast.error(tc("error")),
  });

  return {
    webhooks: (query.data ?? []) as WebhookEndpoint[],
    isLoading: query.isPending && !!tenantId,
    isError: query.isError,
    create: createM.mutateAsync,
    update: updateM.mutateAsync,
    remove: deleteM.mutateAsync,
    rotate: rotateM.mutateAsync,
  };
}

export function useWebhookDeliveries(webhookId: string | null) {
  const qc = useQueryClient();
  const t = useTranslations("notifications");
  const tc = useTranslations("common");

  const query = useQuery({
    queryKey: ["webhook-deliveries", webhookId],
    queryFn: () => listWebhookDeliveries(webhookId as string),
    enabled: !!webhookId,
  });

  const redeliverM = useMutation({
    mutationFn: (deliveryId: string) => redeliverWebhook(deliveryId),
    onSuccess: () => {
      toast.success(t("webhooks.redelivered"));
      qc.invalidateQueries({ queryKey: ["webhook-deliveries"] });
    },
    onError: () => toast.error(tc("error")),
  });

  return {
    deliveries: query.data ?? [],
    isLoading: query.isPending && !!webhookId,
    redeliver: redeliverM.mutateAsync,
  };
}
