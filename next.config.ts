import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone is for the Docker/VPS image; Hostinger web apps run `next start`
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  experimental: {
    // Client router cache: repeat/back navigations reuse the RSC payload
    // briefly instead of re-hitting the server (mutations still refresh).
    staleTimes: { dynamic: 30, static: 180 },
    // Invoice PDFs are sent to a server action (createInvoice); the default
    // body cap is 1 MB, which silently fails larger files. Match the 25 MB
    // upload limit.
    serverActions: { bodySizeLimit: "25mb" },
  },
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
