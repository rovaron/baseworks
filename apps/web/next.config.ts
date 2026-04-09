import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

// Vercel deployment requires these environment variables:
//   NEXT_PUBLIC_API_URL  — Backend API URL (e.g., https://api.example.com)
//   NEXT_PUBLIC_APP_URL  — This app's public URL (e.g., https://app.example.com)
// No vercel.json needed — Vercel auto-detects Next.js (D-11 zero-config).

const withNextIntl = createNextIntlPlugin("./lib/i18n.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@baseworks/ui", "@baseworks/api-client", "@baseworks/i18n"],
  // Type checking runs separately via `bun run typecheck` at root.
  // Disabled here because @baseworks/api-client has a type-only import
  // to @baseworks/api (the Elysia app type for Eden Treaty), which chains
  // into backend modules not resolvable from the web app context.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default withNextIntl(nextConfig);
