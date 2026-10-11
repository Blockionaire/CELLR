import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera is needed for label scanning; everything else is off.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @cellr/domain is shipped as TypeScript source (no build step), so Next must compile it.
  transpilePackages: ["@cellr/domain"],
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(config);
