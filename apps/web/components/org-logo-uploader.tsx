"use client";

// Phase 29 / IDA-02 — /team/settings org-logo uploader. Owner/admin only on the
// CLIENT (UX gate); the server `organization.canWrite` (isOwnerOrAdmin) remains
// the authority and returns 403 on attach for non-owners. The current logo is
// resolved via list-for-record → newest uploaded/ready → signed read URL.

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FileUpload,
  Skeleton,
} from "@baseworks/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useTenant } from "@/components/tenant-provider";
import {
  attachFile,
  buildFileUploadLabels,
  completeUpload,
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  makeSign,
  resolveLatestReadUrl,
} from "@/lib/file-upload-adapters";

export function OrgLogoUploader() {
  const t = useTranslations("files");
  const queryClient = useQueryClient();
  const { activeTenant, activeRole } = useTenant();
  const tenantId = activeTenant?.id;
  const canWrite = activeRole === "owner" || activeRole === "admin";

  const logoQuery = useQuery({
    queryKey: ["org-logo", tenantId],
    queryFn: async (): Promise<string | null> => {
      if (!tenantId) return null;
      return resolveLatestReadUrl("organization", tenantId);
    },
    enabled: !!tenantId,
  });

  const sign = makeSign("organization");
  const labels = buildFileUploadLabels(t);

  const attachMutation = useMutation({
    mutationFn: async (fileId: string) => {
      if (!tenantId) throw new Error("no tenant");
      await attachFile({ fileId, ownerRecordType: "organization", ownerRecordId: tenantId });
    },
    onSuccess: () => {
      toast.success(t("done"));
      queryClient.invalidateQueries({ queryKey: ["org-logo", tenantId] });
    },
    onError: () => {
      toast.error(t("errors.unknown"));
    },
  });

  const logoUrl = logoQuery.data ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("logo.title")}</CardTitle>
        <CardDescription>{t("logo.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          {logoQuery.isPending ? (
            <Skeleton className="h-16 w-16 rounded-md" />
          ) : (
            <Avatar className="h-16 w-16 rounded-md">
              {logoUrl ? <AvatarImage src={logoUrl} alt={t("logo.title")} /> : null}
              <AvatarFallback className="rounded-md">
                {activeTenant?.name?.[0]?.toUpperCase() ?? "?"}
              </AvatarFallback>
            </Avatar>
          )}
        </div>

        {canWrite ? (
          <FileUpload
            sign={sign}
            complete={completeUpload}
            onUploaded={({ fileId }) => attachMutation.mutateAsync(fileId)}
            accept={IMAGE_ACCEPT}
            maxByteSize={IMAGE_MAX_BYTES}
            labels={labels}
            disabled={!tenantId}
            aria-label={t("logo.title")}
          />
        ) : (
          <p className="text-sm text-muted-foreground" role="note">
            {t("logo.ownerOnly")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
