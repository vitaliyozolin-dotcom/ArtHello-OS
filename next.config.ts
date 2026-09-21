import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  typescript: { tsconfigPath: "tsconfig.next.json" },
};

export default nextConfig;
