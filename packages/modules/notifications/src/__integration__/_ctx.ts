// packages/modules/notifications/src/__integration__/_ctx.ts
import { getRlsDb, withTenant } from "@baseworks/db";
import type { HandlerContext } from "@baseworks/shared";

/** Minimal RLS-scoped HandlerContext for live notify() tests. */
export function makeCtx(tenantId: string, userId: string): HandlerContext {
  return {
    tenantId,
    userId,
    db: null as any,
    emit: () => {},
    withTenant: <T>(fn: (tx: any) => Promise<T>) => withTenant(getRlsDb(), tenantId, fn),
    dispatch: async () => ({ success: true, data: [] }),
  };
}
