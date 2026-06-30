// apps/admin/src/routes/webhooks/list.tsx
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@baseworks/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { api } from "@/lib/api";
import { WebhookDeliveriesDialog } from "./deliveries-dialog";

interface WebhookRow {
  id: string;
  tenantId: string;
  tenantName: string | null;
  url: string;
  categories: string[] | null;
  status: string;
  consecutiveFailures: string;
  lastStatus: string | null;
  lastDeliveryAt: string | null;
  disabledReason: string | null;
  createdAt: string;
}

const PAGE_SIZE = 20;

function statusBadge(status: string, t: (k: string) => string) {
  if (status === "active") return <Badge variant="default">{t("webhooks.status.active")}</Badge>;
  if (status === "disabled")
    return <Badge variant="secondary">{t("webhooks.status.disabled")}</Badge>;
  if (status === "admin_disabled")
    return <Badge variant="destructive">{t("webhooks.status.adminDisabled")}</Badge>;
  return <Badge variant="destructive">{t("webhooks.status.autoDisabled")}</Badge>;
}

export function Component() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [disableTarget, setDisableTarget] = useState<WebhookRow | null>(null);
  const [reason, setReason] = useState("");
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const {
    data: result,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin", "webhooks", page, search, status],
    queryFn: async () => {
      const res = await api.api.admin.webhooks.get({
        query: {
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
          search,
          ...(status !== "all" ? { status } : {}),
        },
      });
      if (res.error) throw res.error;
      return res.data;
    },
  });

  const disableMutation = useMutation({
    mutationFn: async (target: WebhookRow) => {
      const res = await (api.api.admin.webhooks as any)({ id: target.id }).disable.patch({
        reason,
      });
      if (res.error) throw new Error(res.error?.value?.message ?? "request failed");
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("webhooks.toast.disabled"));
      queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
      setDisableTarget(null);
      setReason("");
    },
    onError: () => {
      toast.error(t("webhooks.toast.disableFailed"));
    },
  });

  const reenableMutation = useMutation({
    mutationFn: async (target: WebhookRow) => {
      const res = await (api.api.admin.webhooks as any)({ id: target.id }).enable.patch({});
      if (res.error) throw new Error(res.error?.value?.message ?? "request failed");
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("webhooks.toast.reenabled"));
      queryClient.invalidateQueries({ queryKey: ["admin", "webhooks"] });
    },
    onError: () => {
      toast.error(t("webhooks.toast.reenableFailed"));
    },
  });

  const rows = (result as any)?.data ?? [];
  const total = (result as any)?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<WebhookRow, any>[] = [
    {
      accessorKey: "tenantName",
      header: t("webhooks.columns.tenant"),
      cell: ({ row }) => row.original.tenantName ?? row.original.tenantId,
      meta: { priority: 1 },
    },
    {
      accessorKey: "url",
      header: t("webhooks.columns.url"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.url}</span>,
      meta: { priority: 2 },
    },
    {
      id: "categories",
      header: t("webhooks.columns.categories"),
      cell: ({ row }) => (row.original.categories ?? []).join(", "),
      meta: { priority: 3 },
    },
    {
      id: "status",
      header: t("webhooks.columns.status"),
      cell: ({ row }) => statusBadge(row.original.status, t),
      meta: { priority: 1 },
    },
    {
      accessorKey: "consecutiveFailures",
      header: t("webhooks.columns.failures"),
      meta: { priority: 3 },
    },
    {
      id: "actions",
      header: "",
      meta: { cardHidden: true },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">{tc("openMenu")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setDeliveriesFor(row.original.id)}>
              {t("webhooks.actions.viewDeliveries")}
            </DropdownMenuItem>
            {row.original.status !== "active" && (
              <DropdownMenuItem onClick={() => reenableMutation.mutate(row.original)}>
                {t("webhooks.actions.reenable")}
              </DropdownMenuItem>
            )}
            {row.original.status !== "admin_disabled" && (
              <DropdownMenuItem
                onClick={() => setDisableTarget(row.original)}
                className="text-destructive"
              >
                {t("webhooks.actions.forceDisable")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("webhooks.title")}</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground mb-4">{t("webhooks.loadError")}</p>
            <Button variant="outline" onClick={() => refetch()}>
              {tc("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("webhooks.title")}</h1>

      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">{t("webhooks.filter.label")}</Label>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("webhooks.filter.all")}</SelectItem>
            <SelectItem value="active">{t("webhooks.filter.active")}</SelectItem>
            <SelectItem value="disabled">{t("webhooks.filter.disabled")}</SelectItem>
            <SelectItem value="auto_disabled">{t("webhooks.filter.autoDisabled")}</SelectItem>
            <SelectItem value="admin_disabled">{t("webhooks.filter.adminDisabled")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isLoading && rows.length === 0 && !search && status === "all" ? (
        <p className="text-sm text-muted-foreground py-12 text-center">{t("webhooks.empty")}</p>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={t("webhooks.searchPlaceholder")}
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          pageCount={pageCount}
          pageIndex={page}
          onPaginationChange={setPage}
        />
      )}

      <WebhookDeliveriesDialog webhookId={deliveriesFor} onClose={() => setDeliveriesFor(null)} />

      <Dialog
        open={!!disableTarget}
        onOpenChange={() => {
          setDisableTarget(null);
          setReason("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("webhooks.disableDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("webhooks.disableDialog.description", { url: disableTarget?.url })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="disable-reason">{t("webhooks.disableDialog.reasonLabel")}</Label>
            <Input id="disable-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setDisableTarget(null);
                setReason("");
              }}
            >
              {t("webhooks.disableDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => disableTarget && disableMutation.mutate(disableTarget)}
              disabled={disableMutation.isPending}
            >
              {disableMutation.isPending
                ? t("webhooks.disableDialog.disabling")
                : t("webhooks.disableDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
