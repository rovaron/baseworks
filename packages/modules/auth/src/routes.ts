import { Elysia } from "elysia";
import { auth } from "./auth";

/**
 * Auth routes plugin. Mounts better-auth's handler.
 *
 * IMPORTANT (Pitfall 1): better-auth is configured with basePath: "/api/auth",
 * so it handles its own routing internally. We mount WITHOUT a prefix here
 * to avoid path doubling (/api/auth/api/auth/*).
 *
 * Routes served: /api/auth/* (signup, login, logout, OAuth callbacks, magic link, etc.)
 * Verify with: GET /api/auth/ok -> 200
 */
export const authRoutes = new Elysia({ name: "auth-routes" }).mount(
  auth.handler,
);
