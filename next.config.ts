import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone is for the Docker/VPS image; Hostinger web apps run `next start`
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
