"use client";

// Phase 29 / IDA-01 — /profile avatar uploader. Wires the backend-AGNOSTIC
// <FileUpload> (packages/ui) to the Eden files endpoints (sign → PUT → complete
// → attach) and shows the current avatar from GET /api/profile (`avatarUrl` is
// always a short-lived SIGNED read URL — never a raw storage key).

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
import { api } from "@/lib/api";
import {
  attachFile,
  buildFileUploadLabels,
  completeUpload,
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  makeSign,
} from "@/lib/file-upload-adapters";

function initials(name?: string | null, email?: string | null): string {
  if (name) {
    return name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

export function AvatarUploader() {
  const t = useTranslations("files");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await api.api.profile.get();
      if (res.error || !res.data) throw new Error("profile");
      // The route's success body is the profile object; the global error
      // middleware's envelope shapes ({ success: false, ... }) also widen the
      // typed response union, so narrow positively on the profile discriminant.
      const data = res.data;
      if (!("id" in data)) throw new Error("profile");
      return data;
    },
  });

  const sign = makeSign("user");
  const labels = buildFileUploadLabels(t);

  const attachMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const userId = profileQuery.data?.id;
      if (!userId) throw new Error("no user");
      await attachFile({ fileId, ownerRecordType: "user", ownerRecordId: userId });
    },
    onSuccess: () => {
      toast.success(t("done"));
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: () => {
      toast.error(t("errors.unknown"));
    },
  });

  const profile = profileQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("avatar.title")}</CardTitle>
        <CardDescription>{t("avatar.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          {profileQuery.isPending ? (
            <Skeleton className="h-16 w-16 rounded-full" />
          ) : (
            <Avatar className="h-16 w-16">
              {profile?.avatarUrl ? (
                <AvatarImage src={profile.avatarUrl} alt={t("avatar.current")} />
              ) : null}
              <AvatarFallback>{initials(profile?.name, profile?.email)}</AvatarFallback>
            </Avatar>
          )}
          <div className="text-sm text-muted-foreground">
            {profile?.name ?? profile?.email ?? tc("loading")}
          </div>
        </div>

        <FileUpload
          sign={sign}
          complete={completeUpload}
          onUploaded={({ fileId }) => attachMutation.mutateAsync(fileId)}
          accept={IMAGE_ACCEPT}
          maxByteSize={IMAGE_MAX_BYTES}
          labels={labels}
          disabled={!profile?.id}
          aria-label={t("avatar.title")}
        />
      </CardContent>
    </Card>
  );
}
