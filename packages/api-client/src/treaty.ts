import { treaty } from "@elysiajs/eden";
import type { App } from "@baseworks/api";

/**
 * Eden Treaty client factory.
 *
 * Creates a fully typed API client from the Elysia app type.
 * The `credentials: "include"` setting ensures cookies (better-auth session)
 * are sent on cross-origin requests (Pitfall 4 / T-4-04).
 *
 * @param baseUrl - The API server URL (e.g., "http://localhost:3000")
 */
export function createApiClient(baseUrl: string) {
  return treaty<App>(baseUrl, {
    fetch: {
      credentials: "include",
    },
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
