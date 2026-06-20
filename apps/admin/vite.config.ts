import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // Phase 22 / OPS-02 / D-05 — same-origin proxy so bull-board iframe inherits the
      // admin-origin better-auth session cookie. changeOrigin rewrites the Host header
      // so better-auth's cookie domain check passes. ws: true is defensive — bull-board
      // currently uses HTTP polling (RESEARCH §Pattern 2 verified), but enabling WS
      // proxying costs nothing and survives a future bull-board release that adds it.
      "/admin/bull-board": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
      // Phase 22 / OPS-03 — same-origin fetch path for the new /health/detailed
      // endpoint that lives at the API root (not under /api/).
      "/health/detailed": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
