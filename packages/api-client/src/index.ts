// Factory exports (for custom configuration)

export { createAuth, platformAdminRoles } from "./auth-client";
export { type ApiClient, createApiClient } from "./treaty";

import { createAuth } from "./auth-client";
// Pre-configured default instances (per D-04)
// These use the API_URL environment variable. In Next.js this is
// NEXT_PUBLIC_API_URL; in Vite this is VITE_API_URL. We read from
// both and fall back to localhost.
import { createApiClient } from "./treaty";

let warnedLocalhostFallback = false;

const isDevelopment = (): boolean => {
  // Next.js / Node env
  if (typeof process !== "undefined" && process.env?.NODE_ENV) {
    return process.env.NODE_ENV === "development";
  }
  // Vite env
  if (typeof import.meta !== "undefined") {
    const viteEnv = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    if (viteEnv) return Boolean(viteEnv.DEV);
  }
  // Unknown environment: assume development so we don't warn spuriously
  return true;
};

const getApiUrl = (): string => {
  // Next.js env
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  // Vite env
  if (typeof import.meta !== "undefined") {
    const viteEnv = (import.meta as unknown as { env?: { VITE_API_URL?: string } }).env;
    if (viteEnv?.VITE_API_URL) return viteEnv.VITE_API_URL;
  }
  // No explicit API URL configured. In non-development builds this almost
  // certainly indicates a misconfiguration, so surface it once (do not throw)
  // before falling back to localhost.
  if (!warnedLocalhostFallback && !isDevelopment()) {
    warnedLocalhostFallback = true;
    console.warn(
      "[api-client] No API URL configured (NEXT_PUBLIC_API_URL / VITE_API_URL). " +
        "Falling back to http://localhost:3000 in a non-development environment. " +
        "Set the appropriate API URL env var for this build.",
    );
  }
  return "http://localhost:3000";
};

export const api = createApiClient(getApiUrl());
export const auth = createAuth(getApiUrl());
