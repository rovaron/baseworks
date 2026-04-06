export interface TenantContext {
  tenantId: string;
}

export interface AppContext extends TenantContext {
  userId?: string;
}
