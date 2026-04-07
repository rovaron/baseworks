import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@baseworks/ui", "@baseworks/api-client"],
  // Type checking runs separately via `bun run typecheck` at root.
  // Disabled here because @baseworks/api-client has a type-only import
  // to @baseworks/api (the Elysia app type for Eden Treaty), which chains
  // into backend modules not resolvable from the web app context.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
