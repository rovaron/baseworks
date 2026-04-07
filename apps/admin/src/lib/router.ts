import { createBrowserRouter } from "react-router";

export const router = createBrowserRouter([
  {
    path: "/login",
    lazy: () => import("../routes/login"),
  },
  {
    path: "/",
    lazy: () => import("../layouts/admin-layout"),
    children: [
      { index: true, lazy: () => import("../routes/tenants/list") },
      { path: "tenants", lazy: () => import("../routes/tenants/list") },
      { path: "tenants/:id", lazy: () => import("../routes/tenants/detail") },
      { path: "users", lazy: () => import("../routes/users/list") },
      { path: "users/:id", lazy: () => import("../routes/users/detail") },
      { path: "billing", lazy: () => import("../routes/billing/overview") },
      { path: "system", lazy: () => import("../routes/system/health") },
    ],
  },
]);
