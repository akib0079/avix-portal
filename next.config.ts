import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone is for the Docker/VPS image; Hostinger web apps run `next start`
  output: process.env.DOCKER_BUILD ? "standalone" : undefined,
  experimental: {
    // Client router cache: repeat/back navigations reuse the RSC payload
    // instead of re-hitting the server. 90s is comfortable because every
    // mutation calls revalidatePath, which evicts the entry immediately.
    staleTimes: { dynamic: 90, static: 300 },
    // Barrel-file imports pull the whole library into the client graph. Next
    // optimises a default list; these three are the heavy ones this app uses
    // and date-fns/recharts are not on it.
    optimizePackageImports: ["lucide-react", "date-fns", "recharts", "@tiptap/react"],
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
