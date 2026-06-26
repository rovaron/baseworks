import path from "path";
import { defineConfig } from "vitest/config";

// Phase 2-web — first React component/hook tests in apps/web.
// Mirrors apps/admin: jsdom + @testing-library/react. The Vite plugin chain is
// intentionally NOT included (unit tests stub @baseworks/ui, lucide-react,
// next-intl, so no JSX transform of shadcn or tailwind is needed; React 19 +
// Vitest's built-in JSX handling is sufficient).
export default defineConfig({
  // apps/web tsconfig uses jsx: "preserve"; force the automatic React 19 JSX
  // runtime here so test files need no explicit `import React` (matches admin,
  // whose tsconfig already uses jsx: "react-jsx").
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
