import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    // Scope hoisting (production only) merges most of Mediabunny into one module but leaves
    // output-format.js outside it, and the two import each other. The runtime then starts the
    // merged module again from inside its own first run, so Mediabunny is evaluated twice and
    // its muxers get a second copy of the library's classes. Dev never hoists, so turning it off
    // also makes production run the same module setup that development is tested with.
    turbopackScopeHoisting: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The app never records from devices; deny these so injected code cannot either.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
