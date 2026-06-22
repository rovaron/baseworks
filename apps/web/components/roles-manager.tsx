"use client";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@baseworks/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useTenant } from "@/components/tenant-provider";
import { auth } from "@/lib/api";

// Editable resources for tenant-defined roles (subset of the catalog).
const MATRIX: Record<string, string[]> = {
  files: ["read", "write", "delete", "admin"],
  billing: ["read", "manage"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
};
const BUILT_IN = new Set(["owner", "admin", "member"]);

export function RolesManager() {
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const { activeTenant } = useTenant();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<{ name: string; perms: Record<string, string[]> } | null>(
    null,
  );

  const rolesQuery = useQuery({
    queryKey: ["org-roles", activeTenant?.id],
    enabled: !!activeTenant?.id,
    queryFn: async () => {
      const res = await auth.organization.listOrgRoles({
        query: { organizationId: activeTenant!.id },
      });
      return (res.data as any[]) ?? [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (role: { name: string; perms: Record<string, string[]> }) => {
      await auth.organization.createOrgRole({
        organizationId: activeTenant!.id,
        role: role.name,
        permission: role.perms,
      });
    },
    onSuccess: () => {
      toast.success(t("toast.saved"));
      qc.invalidateQueries({ queryKey: ["org-roles"] });
      setEditing(null);
    },
    onError: () => toast.error(tc("error")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (roleName: string) => {
      await auth.organization.deleteOrgRole({ organizationId: activeTenant!.id, roleName });
    },
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      qc.invalidateQueries({ queryKey: ["org-roles"] });
    },
    onError: () => toast.error(tc("error")),
  });

  const customRoles = (rolesQuery.data ?? []).filter((r: any) => !BUILT_IN.has(r.role));

  function toggle(resource: string, action: string) {
    if (!editing) return;
    const cur = new Set(editing.perms[resource] ?? []);
    cur.has(action) ? cur.delete(action) : cur.add(action);
    setEditing({ ...editing, perms: { ...editing.perms, [resource]: [...cur] } });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t("title")}</h2>
          <Button onClick={() => setEditing({ name: "", perms: {} })}>{t("create")}</Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.role")}</TableHead>
              <TableHead>{t("columns.permissions")}</TableHead>
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customRoles.map((r: any) => (
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
                    className="text-destructive"
                    onClick={() => deleteMutation.mutate(r.role)}
                  >
                    {tc("delete")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dialog.title")}</DialogTitle>
            </DialogHeader>
            <Input
              placeholder={t("dialog.namePlaceholder")}
              value={editing?.name ?? ""}
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
                {tc("cancel")}
              </Button>
              <Button
                disabled={!editing?.name || saveMutation.isPending}
                onClick={() => editing && saveMutation.mutate(editing)}
              >
                {tc("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
