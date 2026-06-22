import { createBrowserRouter } from "react-router";
import { RouteError } from "../components/route-error";

export const router = createBrowserRouter([
  {
    path: "/login",
    lazy: () => import("../routes/login"),
    ErrorBoundary: RouteError,
  },
  {
    path: "/",
    lazy: () => import("../layouts/admin-layout"),
    ErrorBoundary: RouteError,
    children: [
      { index: true, lazy: () => import("../routes/tenants/list") },
      { path: "tenants", lazy: () => import("../routes/tenants/list") },
      { path: "tenants/:id", lazy: () => import("../routes/tenants/detail") },
      { path: "roles", lazy: () => import("../routes/roles/list") },
      { path: "users", lazy: () => import("../routes/users/list") },
      { path: "users/:id", lazy: () => import("../routes/users/detail") },
      { path: "billing", lazy: () => import("../routes/billing/overview") },
      { path: "system", lazy: () => import("../routes/system/health") },
      { path: "jobs", lazy: () => import("../routes/jobs") },
    ],
  },
]);
