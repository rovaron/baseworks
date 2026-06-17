"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { auth } from "@/lib/api";

interface TenantContext {
  activeTenant: { id: string; name: string; slug: string } | null;
  tenants: Array<{ id: string; name: string; slug: string }>;
  setActiveTenant: (orgId: string) => Promise<void>;
  isLoading: boolean;
  // Phase 29 / IDA-02 — the current user's role in the active tenant. Drives the
  // client-side org-logo write gate (server `organization.canWrite` is the
  // authority). Sourced from better-auth's useActiveMember() (no new route).
  activeRole: "owner" | "admin" | "member" | null;
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
  const activeMemberQuery = auth.useActiveMember();

  const activeRole = useMemo<TenantContext["activeRole"]>(() => {
    const role = (activeMemberQuery.data as { role?: string } | null | undefined)?.role;
    if (role === "owner" || role === "admin" || role === "member") return role;
    return null;
  }, [activeMemberQuery.data]);

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
    () => ({ activeTenant, tenants, setActiveTenant, isLoading, activeRole }),
    [activeTenant, tenants, setActiveTenant, isLoading, activeRole],
  );

  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}
