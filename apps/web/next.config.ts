import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Vercel deployment requires these environment variables:
//   NEXT_PUBLIC_API_URL  — Backend API URL (e.g., https://api.example.com)
//   NEXT_PUBLIC_APP_URL  — This app's public URL (e.g., https://app.example.com)
// No vercel.json needed — Vercel auto-detects Next.js (D-11 zero-config).

const withNextIntl = createNextIntlPlugin("./lib/i18n.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@baseworks/ui", "@baseworks/api-client", "@baseworks/i18n"],
  // Type checking runs separately via `bun run typecheck` at root,
  // which type-checks apps/web against its own tsconfig (with the full
  // @baseworks/* path aliases so Eden Treaty's App type resolves).
};

export default withNextIntl(nextConfig);
