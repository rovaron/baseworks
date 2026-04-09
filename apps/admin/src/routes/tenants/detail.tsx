import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@baseworks/ui";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function Component() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const { data: result, isLoading } = useQuery({
    queryKey: ["admin", "tenants", id],
    queryFn: async () => {
      const res = await (api.api.admin.tenants as any)({ id: id! }).get();
      return res.data;
    },
    enabled: !!id,
  });

  const tenant = result as any;
  const isDeactivated = tenant?.metadata?.deactivated;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      await (api.api.admin.tenants as any)({ id: id! }).patch({
        metadata: isDeactivated
          ? { deactivated: false, reactivatedAt: new Date().toISOString() }
          : { deactivated: true, deactivatedAt: new Date().toISOString() },
      });
    },
    onSuccess: () => {
      toast.success(isDeactivated ? t("tenants.toast.reactivated") : t("tenants.toast.deactivated"));
      queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      setShowDeactivateDialog(false);
    },
    onError: () => {
      toast.error(t("tenants.toast.updateFailed"));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/tenants")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("tenants.detail.backToTenants")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("tenants.detail.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/tenants")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {tc("back")}
        </Button>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        {isDeactivated ? (
          <Badge variant="destructive">{t("tenants.status.deactivated")}</Badge>
        ) : (
          <Badge variant="default">{t("tenants.status.active")}</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("tenants.detail.tenantInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("tenants.detail.name")}</p>
              <p>{tenant.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("tenants.detail.slug")}</p>
              <p className="break-all">{tenant.slug}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{t("tenants.detail.created")}</p>
              <p>{(() => {
                const d = tenant.createdAt ? new Date(tenant.createdAt) : null;
                return d && !isNaN(d.getTime())
                  ? formatDistanceToNow(d, { addSuffix: true })
                  : "\u2014";
              })()}</p>
            </div>
            {tenant.memberCount !== undefined && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t("tenants.detail.members")}</p>
                <p>{tenant.memberCount}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("tenants.detail.actions")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant={isDeactivated ? "default" : "destructive"}
              className="w-full"
              onClick={() => setShowDeactivateDialog(true)}
            >
              {isDeactivated ? t("tenants.detail.reactivate") : t("tenants.detail.deactivate")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isDeactivated ? t("tenants.detail.reactivateDialog.title") : t("tenants.detail.deactivateDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {isDeactivated
                ? t("tenants.detail.reactivateDialog.description", { name: tenant.name })
                : t("tenants.detail.deactivateDialog.description", { name: tenant.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowDeactivateDialog(false)}>
              {isDeactivated ? tc("cancel") : t("tenants.deactivateDialog.keepActive")}
            </Button>
            <Button
              variant={isDeactivated ? "default" : "destructive"}
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
            >
              {toggleMutation.isPending
                ? t("tenants.deactivateDialog.deactivating")
                : isDeactivated
                  ? t("tenants.detail.reactivate")
                  : t("tenants.detail.deactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
