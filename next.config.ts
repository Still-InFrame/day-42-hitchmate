import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home dir can make Turbopack pick the wrong
  // workspace root; pin it to this app.
  turbopack: { root: __dirname },
};

export default nextConfig;
