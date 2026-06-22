import {
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@baseworks/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

/**
 * Operator read-only view of a tenant's roles (Task A12). Operators are not org
 * members, so custom-role CRUD is gated by the tenant's `ac` permission and lives
 * elsewhere; here we only READ a selected tenant's roles via the gated admin
 * endpoint `GET /api/admin/tenants/:id/roles` (added in Task B5). Until that route
 * lands the query simply returns no rows — acceptable, the view is read-only.
 */
export function Component() {
  const { t } = useTranslation("admin");
  const [tenantId, setTenantId] = useState<string | undefined>(undefined);

  // Reuse the tenants list query so operators can pick a tenant to inspect.
  const { data: tenantsResult } = useQuery({
    queryKey: ["admin", "tenants", "all"],
    queryFn: async () => {
      const res = await api.api.admin.tenants.get({ query: { limit: 100, offset: 0, search: "" } });
      if (res.error) throw res.error;
      return res.data;
    },
  });

  const tenants: TenantOption[] = (tenantsResult as any)?.data ?? [];

  const {
    data: rolesResult,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin", "tenant-roles", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      // The `tenants/:id/roles` endpoint lands in Task B5; cast until the typed
      // route exists. Read-only and behind the operator gate.
      const res = await (api.api.admin.tenants as any)({ id: tenantId }).roles.get();
      if (res.error) throw res.error;
      return res.data;
    },
  });

  const roles: OrgRole[] = (rolesResult as any)?.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("roles.title")}</h1>

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
      ) : error ? (
        <p className="text-sm text-muted-foreground">{t("roles.loadError")}</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            {!isLoading && roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("roles.empty")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {roles.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.role}</span>
                    {" — "}
                    {Object.entries(r.permission ?? {})
                      .map(([res, actions]) => `${res}:${(actions as string[]).join("/")}`)
                      .join("  ")}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
