// Factory exports (for custom configuration)
export { createApiClient, type ApiClient } from "./treaty";
export { createAuth } from "./auth-client";

// Pre-configured default instances (per D-04)
// These use the API_URL environment variable. In Next.js this is
// NEXT_PUBLIC_API_URL; in Vite this is VITE_API_URL. We read from
// both and fall back to localhost.
import { createApiClient } from "./treaty";
import { createAuth } from "./auth-client";

const getApiUrl = (): string => {
  // Next.js env
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  // Vite env
  if (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_URL) {
    return (import.meta as any).env.VITE_API_URL;
  }
  return "http://localhost:3000";
};

export const api = createApiClient(getApiUrl());
export const auth = createAuth(getApiUrl());
