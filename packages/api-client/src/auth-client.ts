import { createAuthClient } from "better-auth/react";
import { organizationClient, magicLinkClient } from "better-auth/client/plugins";

/**
 * better-auth React client factory.
 *
 * Creates a client-side auth instance with plugins that mirror the server config:
 * - organizationClient() mirrors server's organization() plugin
 * - magicLinkClient() mirrors server's magicLink() plugin
 *
 * The `credentials: "include"` setting ensures session cookies are sent
 * on cross-origin requests (T-4-04).
 *
 * @param baseUrl - The API server URL (e.g., "http://localhost:3000")
 */
export function createAuth(baseUrl: string) {
  return createAuthClient({
    baseURL: baseUrl,
    plugins: [organizationClient(), magicLinkClient()],
    fetchOptions: {
      credentials: "include",
    },
  });
}
