import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { MoreHorizontal } from "lucide-react";
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
      toast.success("Tenant deactivated");
      queryClient.invalidateQueries({ queryKey: ["admin", "tenants"] });
      setDeactivateTarget(null);
    },
    onError: () => {
      toast.error("Failed to deactivate tenant");
    },
  });

  const tenants = (result as any)?.data ?? [];
  const total = (result as any)?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<Tenant, any>[] = [
    {
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
      meta: { priority: 1 },
    },
    {
      accessorKey: "slug",
      header: "Slug",
      enableSorting: false,
      meta: { priority: 3 },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
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
      header: "Status",
      cell: ({ row }) => {
        const deactivated = row.original.metadata?.deactivated;
        return deactivated ? (
          <Badge variant="destructive">deactivated</Badge>
        ) : (
          <Badge variant="default">active</Badge>
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
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`/tenants/${row.original.id}`)}>
              View details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setDeactivateTarget(row.original)}
              className="text-destructive"
            >
              Deactivate
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tenants</h1>

      {!isLoading && tenants.length === 0 && !search ? (
        <p className="text-sm text-muted-foreground py-12 text-center">
          Your platform has no tenants yet. When users create accounts, their tenants will appear here.
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={tenants}
          isLoading={isLoading}
          searchPlaceholder="Search tenants..."
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
            <DialogTitle>Deactivate tenant</DialogTitle>
            <DialogDescription>
              Deactivating {deactivateTarget?.name} will prevent all members from accessing
              the platform. This can be reversed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeactivateTarget(null)}>
              Keep tenant active
            </Button>
            <Button
              variant="destructive"
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget)}
              disabled={deactivateMutation.isPending}
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate tenant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
