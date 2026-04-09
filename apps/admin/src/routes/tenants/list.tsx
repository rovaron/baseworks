import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
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
} from "@baseworks/ui";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DataTable } from "@/components/data-table";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  metadata: Record<string, any> | null;
}

const PAGE_SIZE = 20;

export function Component() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<Tenant | null>(null);
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("common");

  const { data: result, isLoading } = useQuery({
    queryKey: ["admin", "tenants", page, search],
    queryFn: async () => {
      const res = await api.api.admin.tenants.get({
        query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, search },
      });
      return res.data;
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (tenant: Tenant) => {
      await (api.api.admin.tenants as any)({ id: tenant.id }).patch({
        metadata: { deactivated: true, deactivatedAt: new Date().toISOString() },
      });
    },
    onSuccess: () => {
      toast.success(t("tenants.toast.deactivated"));
      queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      setDeactivateTarget(null);
    },
    onError: () => {
      toast.error(t("tenants.toast.deactivateFailed"));
    },
  });

  const tenants = (result as any)?.data ?? [];
  const total = (result as any)?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<Tenant, any>[] = [
    {
      accessorKey: "name",
      header: t("tenants.columns.name"),
      enableSorting: true,
      meta: { priority: 1 },
    },
    {
      accessorKey: "slug",
      header: t("tenants.columns.slug"),
      enableSorting: false,
      meta: { priority: 3 },
    },
    {
      accessorKey: "createdAt",
      header: t("tenants.columns.created"),
      enableSorting: true,
      cell: ({ row }) => {
        const d = row.original.createdAt ? new Date(row.original.createdAt) : null;
        return d && !isNaN(d.getTime())
          ? formatDistanceToNow(d, { addSuffix: true })
          : "\u2014";
      },
      meta: { priority: 2 },
    },
    {
      id: "status",
      header: t("tenants.columns.status"),
      cell: ({ row }) => {
        const deactivated = row.original.metadata?.deactivated;
        return deactivated ? (
          <Badge variant="destructive">{t("tenants.status.deactivated")}</Badge>
        ) : (
          <Badge variant="default">{t("tenants.status.active")}</Badge>
        );
      },
      meta: { priority: 1 },
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
            <DropdownMenuItem onClick={() => navigate(`/tenants/${row.original.id}`)}>
              {t("tenants.actions.viewDetails")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeactivateTarget(row.original)}
              className="text-destructive"
            >
              {t("tenants.actions.deactivate")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("tenants.title")}</h1>

      {!isLoading && tenants.length === 0 && !search ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {t("tenants.empty")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={tenants}
          isLoading={isLoading}
          searchPlaceholder={t("tenants.searchPlaceholder")}
          searchValue={search}
          onSearchChange={setSearch}
          pageCount={pageCount}
          pageIndex={page}
          onPaginationChange={setPage}
        />
      )}

      <Dialog open={!!deactivateTarget} onOpenChange={() => setDeactivateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tenants.deactivateDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("tenants.deactivateDialog.description", { name: deactivateTarget?.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>
              {t("tenants.deactivateDialog.keepActive")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget)}
              disabled={deactivateMutation.isPending}
            >
              {deactivateMutation.isPending ? t("tenants.deactivateDialog.deactivating") : t("tenants.deactivateDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
