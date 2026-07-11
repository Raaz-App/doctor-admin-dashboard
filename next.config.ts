import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app sits beside doctor-dashboard-v2 (two lockfiles under /code/work); pin the tracing root
  // to THIS app so Next doesn't infer the parent as the workspace root.
  outputFileTracingRoot: import.meta.dirname,
  // Admin pages manage credentials — keep them out of caches and referrer chains.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
