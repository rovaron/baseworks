import { defineConfig } from "vitest/config";
import path from "path";

// Phase 22 / OPS-02 — first React component tests in apps/admin.
// Uses jsdom + @testing-library/react. Vite plugin chain is intentionally NOT included
// (the unit tests stub @baseworks/ui, lucide-react, react-i18next so no JSX transform of
// shadcn or tailwind is needed; React 19 + Vitest's built-in JSX handling is sufficient).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
