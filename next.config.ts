import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run runs the app from a container: `standalone` emits a self-contained
  // server bundle so the runtime image doesn't need node_modules or the source tree.
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/.prisma/client/**"],
  },
  serverExternalPackages: ["@prisma/client", "googleapis", "google-auth-library"],
};

export default nextConfig;
