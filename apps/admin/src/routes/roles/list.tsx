import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface TenantOption {
  id: string;
  name: string;
}

interface OrgRole {
  id: string;
  role: string;
  permission: Record<string, string[]> | null;
}

/** Coerce a loosely-typed JSON permission map from the API into the matrix shape. */
function asPermission(value: unknown): Record<string, string[]> {
  return value !== null && typeof value === "object" ? (value as Record<string, string[]>) : {};
}

/** Pull a human error string out of an Eden error envelope's value union. */
function errorMessage(value: unknown): string {
  if (value !== null && typeof value === "object" && "error" in value) {
    const e = (value as { error: unknown }).error;
    if (typeof e === "string") return e;
  }
  return "request failed";
}

/**
 * The operator-facing permission matrix. Mirrors the Baseworks app resources in
 * the shared statement catalog (access-control.ts). The server validates any
 * submitted permission against that catalog, so this list only needs to cover
 * the resources operators should be able to grant.
 */
const MATRIX: Record<string, string[]> = {
  files: ["read", "write", "delete", "admin"],
  billing: ["read", "manage"],
};

/**
 * Operator tenant-role management (v1.5 — b). Operators are not org members, so
 * CRUD goes through the gated admin routes (`/api/admin/tenants/:id/roles`) which
 * write `organization_role` directly behind requirePlatformAdmin(). Built-in
 * roles (owner/admin/member) are system-managed and never listed here.
 */
export function Component() {
  const { t } = useTranslation("admin");
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<{
    original: string | null;
    name: string;
    perms: Record<string, string[]>;
  } | null>(null);

  const { data: tenantsResult } = useQuery({
    queryKey: ["admin", "tenants", "all"],
    queryFn: async () => {
      const res = await api.api.admin.tenants.get({ query: { limit: 100, offset: 0, search: "" } });
      if (res.error) throw res.error;
      return res.data;
    },
  });
  const tenants: TenantOption[] = tenantsResult?.data ?? [];

  const rolesQuery = useQuery({
    queryKey: ["admin", "tenant-roles", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const res = await api.api.admin.tenants({ id: tenantId! }).roles.get();
      if (res.error) throw res.error;
      return res.data.data.map(
        (r): OrgRole => ({ id: r.id, role: r.role, permission: asPermission(r.permission) }),
      );
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (role: {
      original: string | null;
      name: string;
      perms: Record<string, string[]>;
    }) => {
      // Drop empty resources so the payload only carries granted permissions.
      const permission = Object.fromEntries(
        Object.entries(role.perms).filter(([, actions]) => actions.length > 0),
      );
      const client = api.api.admin.tenants({ id: tenantId! });
      const res = role.original
        ? await client.roles({ role: role.original }).patch({ permission })
        : await client.roles.post({ role: role.name, permission });
      if (res.error) throw new Error(errorMessage(res.error.value));
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("roles.toastSaved"));
      qc.invalidateQueries({ queryKey: ["admin", "tenant-roles", tenantId] });
      setEditing(null);
    },
    onError: () => toast.error(t("roles.toastError")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (roleName: string) => {
      const res = await api.api.admin.tenants({ id: tenantId! }).roles({ role: roleName }).delete();
      if (res.error) throw new Error(errorMessage(res.error.value));
      return res.data;
    },
    onSuccess: () => {
      toast.success(t("roles.toastDeleted"));
      qc.invalidateQueries({ queryKey: ["admin", "tenant-roles", tenantId] });
    },
    onError: () => toast.error(t("roles.toastError")),
  });

  const roles: OrgRole[] = rolesQuery.data ?? [];

  function toggle(resource: string, action: string) {
    if (!editing) return;
    const cur = new Set(editing.perms[resource] ?? []);
    if (cur.has(action)) cur.delete(action);
    else cur.add(action);
    setEditing({ ...editing, perms: { ...editing.perms, [resource]: [...cur] } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("roles.title")}</h1>
        <Button
          disabled={!tenantId}
          onClick={() => setEditing({ original: null, name: "", perms: {} })}
        >
          {t("roles.create")}
        </Button>
      </div>

      <Select value={tenantId} onValueChange={setTenantId}>
        <SelectTrigger className="w-full max-w-sm">
          <SelectValue placeholder={t("roles.selectTenant")} />
        </SelectTrigger>
        <SelectContent>
          {tenants.map((tenant) => (
            <SelectItem key={tenant.id} value={tenant.id}>
              {tenant.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!tenantId ? (
        <p className="text-sm text-muted-foreground">{t("roles.noTenant")}</p>
      ) : rolesQuery.error ? (
        <p className="text-sm text-muted-foreground">{t("roles.loadError")}</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {!rolesQuery.isLoading && roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("roles.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("roles.columnsRole")}</TableHead>
                    <TableHead>{t("roles.columnsPermissions")}</TableHead>
                    <TableHead className="w-[160px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.role}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(r.permission ?? {})
                          .map(([res, acts]) => `${res}:${(acts as string[]).join("/")}`)
                          .join("  ")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditing({
                              original: r.role,
                              name: r.role,
                              perms: { ...(r.permission ?? {}) },
                            })
                          }
                        >
                          {t("roles.edit")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => deleteMutation.mutate(r.role)}
                        >
                          {t("roles.delete")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.original ? t("roles.dialogEditTitle") : t("roles.dialogCreateTitle")}
            </DialogTitle>
          </DialogHeader>
          <Input
            placeholder={t("roles.namePlaceholder")}
            value={editing?.name ?? ""}
            disabled={!!editing?.original}
            onChange={(e) => editing && setEditing({ ...editing, name: e.target.value })}
          />
          <div className="space-y-3">
            {Object.entries(MATRIX).map(([resource, actions]) => (
              <div key={resource}>
                <p className="text-sm font-medium capitalize">{resource}</p>
                <div className="flex flex-wrap gap-3 pt-1">
                  {actions.map((a) => (
                    <label
                      key={a}
                      htmlFor={`perm-${resource}-${a}`}
                      className="flex items-center gap-1 text-sm"
                    >
                      <Checkbox
                        id={`perm-${resource}-${a}`}
                        checked={(editing?.perms[resource] ?? []).includes(a)}
                        onCheckedChange={() => toggle(resource, a)}
                      />
                      {a}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("roles.cancel")}
            </Button>
            <Button
              disabled={!editing?.name || saveMutation.isPending}
              onClick={() => editing && saveMutation.mutate(editing)}
            >
              {t("roles.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
