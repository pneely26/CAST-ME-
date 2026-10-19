import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pdfjs-dist", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
