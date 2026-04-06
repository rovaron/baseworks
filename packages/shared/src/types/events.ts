// Extend in module files:
// declare module '@baseworks/shared' {
//   interface DomainEvents {
//     'user.created': { id: string; tenantId: string }
//   }
// }
export interface DomainEvents {
  [key: string]: Record<string, unknown>;
}
