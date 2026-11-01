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
  experimental: {
    // Tabs you have seen (or that were prefetched) come back from the browser's memory at once instead of
    // asking the server again; the page refreshes itself in the background after this long, and any change
    // you make clears it (see Providers). This is what makes the tab bar feel instant.
    staleTimes: { dynamic: 30, static: 300 },
  },
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The internal admin dashboard: never stored by a shared cache or a browser, never indexed.
      ...["/admin", "/admin/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      })),
      // The static offline page has no scripts and loads nothing: lock it down completely.
      {
        source: "/offline.html",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      // The on-device OCR files (Sprint S) live in a versioned folder (public/ocr/<version>): cached for good. The
      // worker started from them gets its own narrow policy: only its own same-origin files, and compiling its
      // WebAssembly ('wasm-unsafe-eval', not eval). The pages' nonce policy is unchanged.
      {
        source: "/ocr/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          },
        ],
      },
      // The worker file itself must never be served stale, or fixes would not reach installed apps.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(config);
