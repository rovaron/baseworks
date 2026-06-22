// Import from the dedicated access-control subpath (NOT the package barrel):
// the barrel re-exports the server `auth` instance, which would drag
// @baseworks/config/db/queue/observability into the browser bundle and break
// the web/admin production builds. access-control.ts has zero server deps.
import { ac, roles } from "@baseworks/module-auth/access-control";
import { magicLinkClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * better-auth React client factory.
 *
 * Creates a client-side auth instance with plugins that mirror the server config:
 * - organizationClient({ ac, roles }) mirrors server's organization() plugin,
 *   including the shared access-control statement catalog + built-in roles so
 *   client-side permission checks (hasPermission) resolve against the same
 *   vocabulary as the server guard (requirePermission).
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
    plugins: [organizationClient({ ac, roles }), magicLinkClient()],
    fetchOptions: {
      credentials: "include",
    },
  });
}
