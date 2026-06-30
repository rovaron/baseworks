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
  FileUpload,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Eye, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  ADMIN_ACCEPT,
  ADMIN_MAX_BYTES,
  type AdminFileRow,
  adminDeleteFile,
  adminGetReadUrl,
  adminListFiles,
  buildFileUploadLabels,
  makeAdminComplete,
  makeAdminSign,
} from "@/lib/file-upload-adapters";

/** Human-readable byte size (B / KB / MB). */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * A file row is still "in flight" (worth polling for) ONLY while its status can
 * still change on its own:
 *   - status === "transforming": the worker is actively producing variants.
 *   - status === "uploaded" AND a raster image AND no variants yet: it is waiting
 *     for the transform worker to flip it to "ready".
 * A non-image "uploaded" row (e.g. a PDF admin-attachment) is TERMINAL —
 * enqueueTransform GATE-1 skips non-image MIME, so it never advances past
 * "uploaded". Treating it as in-flight would poll the API every 3s forever while
 * the card is mounted. "ready"/"deleted"/"pending" are likewise terminal here.
 */
function isInFlight(f: AdminFileRow): boolean {
  if (f.status === "transforming") return true;
  if (f.status === "uploaded" && f.mimeType.startsWith("image/") && f.variantCount === 0) {
    return true;
  }
  return false;
}

/**
 * Phase 30 / UI-02 — cross-tenant admin Files browser. Lists every live file in
 * the target tenant (name, type, size, status, created), supports View (signed
 * read-url) + Delete (confirm dialog), and uploads via the shipped <FileUpload
 * multi> wired to the gated admin sign/complete endpoints. Bounded polling
 * surfaces image variants once the transform worker finishes.
 */
export function TenantFilesCard({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const { t } = useTranslation("admin");
  const { t: tFiles } = useTranslation("files");
  const filesKey = ["admin", "tenants", tenantId, "files"] as const;

  const [fileToDelete, setFileToDelete] = useState<AdminFileRow | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: filesKey,
    queryFn: () => adminListFiles(tenantId),
    refetchInterval: (q) => (q.state.data?.files.some(isInFlight) ? 3000 : false),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => adminDeleteFile(tenantId, fileId),
    onSuccess: () => {
      toast.success(t("tenants.detail.files.toast.deleted"));
      queryClient.invalidateQueries({ queryKey: filesKey });
      setFileToDelete(null);
    },
    onError: () => {
      toast.error(t("tenants.detail.files.toast.deleteFailed"));
    },
  });

  async function handleView(file: AdminFileRow) {
    setViewingId(file.fileId);
    try {
      const url = await adminGetReadUrl(tenantId, file.fileId);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setViewingId(null);
    }
  }

  function statusBadge(file: AdminFileRow) {
    const variant =
      file.status === "ready" ? "default" : file.status === "pending" ? "outline" : "secondary";
    const label = t(`tenants.detail.files.status.${file.status}`, {
      defaultValue: file.status,
    });
    return (
      <span className="inline-flex items-center gap-2">
        <Badge variant={variant as any}>{label}</Badge>
        {file.status === "ready" && file.variantCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("tenants.detail.files.variants", { count: file.variantCount })}
          </span>
        )}
      </span>
    );
  }

  const files = data?.files ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("tenants.detail.files.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("tenants.detail.files.uploadTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("tenants.detail.files.uploadHint")}</p>
          <FileUpload
            multi
            maxFiles={10}
            accept={ADMIN_ACCEPT}
            maxByteSize={ADMIN_MAX_BYTES}
            sign={makeAdminSign(tenantId)}
            complete={makeAdminComplete(tenantId)}
            onUploaded={() => {
              toast.success(t("tenants.detail.files.toast.uploaded"));
              queryClient.invalidateQueries({ queryKey: filesKey });
            }}
            labels={buildFileUploadLabels(tFiles)}
            aria-label={t("tenants.detail.files.uploadTitle")}
          />
        </div>

        {error ? (
          <p className="text-sm text-muted-foreground">
            {t("tenants.detail.files.toast.loadError")}
          </p>
        ) : isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tenants.detail.files.empty")}</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("tenants.detail.files.columns.name")}</TableHead>
                  <TableHead>{t("tenants.detail.files.columns.type")}</TableHead>
                  <TableHead>{t("tenants.detail.files.columns.size")}</TableHead>
                  <TableHead>{t("tenants.detail.files.columns.status")}</TableHead>
                  <TableHead>{t("tenants.detail.files.columns.created")}</TableHead>
                  <TableHead className="text-right">
                    {t("tenants.detail.files.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const name = file.originalFilename ?? file.fileId;
                  const created = file.createdAt ? new Date(file.createdAt) : null;
                  return (
                    <TableRow key={file.fileId}>
                      <TableCell className="font-medium break-all">{name}</TableCell>
                      <TableCell className="text-muted-foreground">{file.mimeType}</TableCell>
                      <TableCell>{formatBytes(file.byteSize)}</TableCell>
                      <TableCell>{statusBadge(file)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {created && !Number.isNaN(created.getTime())
                          ? formatDistanceToNow(created, { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("tenants.detail.files.view", { name })}
                            disabled={file.status === "pending" || viewingId === file.fileId}
                            onClick={() => handleView(file)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("tenants.detail.files.delete", { name })}
                            onClick={() => setFileToDelete(file)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={fileToDelete !== null} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tenants.detail.files.deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("tenants.detail.files.deleteDialog.description", {
                name: fileToDelete?.originalFilename ?? fileToDelete?.fileId ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setFileToDelete(null)}>
              {t("tenants.detail.files.deleteDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => fileToDelete && deleteMutation.mutate(fileToDelete.fileId)}
            >
              {deleteMutation.isPending
                ? t("tenants.detail.files.deleteDialog.deleting")
                : t("tenants.detail.files.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function Component() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "tenants", id],
    queryFn: async () => {
      const res = await api.api.admin.tenants({ id: id! }).get();
      if (res.error) throw res.error;
      return res.data;
    },
    enabled: !!id,
  });

  const tenant = result && "data" in result ? result.data : undefined;
  const metadata =
    tenant && tenant.metadata !== null && typeof tenant.metadata === "object"
      ? (tenant.metadata as Record<string, unknown>)
      : null;
  const isDeactivated = metadata?.deactivated;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.admin.tenants({ id: id! }).patch({
        metadata: isDeactivated
          ? { deactivated: false, reactivatedAt: new Date().toISOString() }
          : { deactivated: true, deactivatedAt: new Date().toISOString() },
      });
      if (res.error) throw new Error(res.error?.value?.message ?? "request failed");
      return res.data;
    },
    onSuccess: () => {
      toast.success(
        isDeactivated ? t("tenants.toast.reactivated") : t("tenants.toast.deactivated"),
      );
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

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => navigate("/tenants")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("tenants.detail.backToTenants")}
        </Button>
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("tenants.detail.loadError")}</p>
            <Button variant="outline" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          </CardContent>
        </Card>
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
              <p className="text-sm font-medium text-muted-foreground">
                {t("tenants.detail.name")}
              </p>
              <p>{tenant.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("tenants.detail.slug")}
              </p>
              <p className="break-all">{tenant.slug}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("tenants.detail.created")}
              </p>
              <p>
                {(() => {
                  const d = tenant.createdAt ? new Date(tenant.createdAt) : null;
                  return d && !Number.isNaN(d.getTime())
                    ? formatDistanceToNow(d, { addSuffix: true })
                    : "\u2014";
                })()}
              </p>
            </div>
            {tenant.memberCount !== undefined && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {t("tenants.detail.members")}
                </p>
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

      {id && <TenantFilesCard tenantId={id} />}

      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isDeactivated
                ? t("tenants.detail.reactivateDialog.title")
                : t("tenants.detail.deactivateDialog.title")}
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
