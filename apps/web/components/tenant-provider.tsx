"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "@/lib/api";

interface TenantContext {
  activeTenant: { id: string; name: string; slug: string } | null;
  tenants: Array<{ id: string; name: string; slug: string }>;
  setActiveTenant: (orgId: string) => Promise<void>;
  isLoading: boolean;
}

const TenantCtx = createContext<TenantContext | null>(null);

export function useTenant() {
  const context = useContext(TenantCtx);
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const activeOrgQuery = auth.useActiveOrganization();
  const listOrgsQuery = auth.useListOrganizations();

  const activeTenant = useMemo(() => {
    const org = activeOrgQuery.data;
    if (!org) return null;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
    };
  }, [activeOrgQuery.data]);

  const tenants = useMemo(() => {
    const orgs = listOrgsQuery.data;
    if (!orgs) return [];
    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
    }));
  }, [listOrgsQuery.data]);

  const setActiveTenant = useCallback(
    async (orgId: string) => {
      await auth.organization.setActive({ organizationId: orgId });
      // Invalidate all queries so data refreshes for the new tenant context
      queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const isLoading = activeOrgQuery.isPending || listOrgsQuery.isPending;

  const value = useMemo<TenantContext>(
    () => ({ activeTenant, tenants, setActiveTenant, isLoading }),
    [activeTenant, tenants, setActiveTenant, isLoading],
  );

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}
