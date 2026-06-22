"use client";

import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/components/tenant-provider";
import { auth } from "@/lib/api";

/**
 * Client-side permission check for conditional UI. UX ONLY — the server guard
 * (requirePermission) is the real enforcement boundary.
 */
export function usePermission(resource: string, action: string) {
  const { activeTenant } = useTenant();
  const query = useQuery({
    queryKey: ["permission", activeTenant?.id, resource, action],
    enabled: !!activeTenant?.id,
    queryFn: async () => {
      const res = await auth.organization.hasPermission({
        organizationId: activeTenant!.id,
        permissions: { [resource]: [action] },
      });
      return res.data?.success ?? false;
    },
  });
  return { allowed: query.data ?? false, isLoading: query.isPending };
}
