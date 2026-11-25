import type { MetadataRoute } from "next";

/**
 * CELLR Admin as its own installable web app, beside the CELLR app on the same domain. The CELLR app's manifest
 * (app/manifest.ts, /manifest.webmanifest) is untouched; the admin pages link this one instead (app/admin/layout.tsx),
 * so "Add to Home Screen" on /admin installs an app that opens /admin, with its own name and icon.
 *
 * - `id` "/admin" (the CELLR app's is "/", its start_url): two apps, installed and updated apart.
 * - `scope` "/": signing in (/sign-in), the session refresh and signing out happen outside /admin, and must stay in
 *   the installed window. With scope "/admin" iOS would open them in a browser sheet whose cookies are not the
 *   app's, and the admin would never stay signed in.
 * - Public by design (the proxy lets it through): names, colours, icons and the start page only. Nothing about the
 *   admin's data or who may use it is here; /admin itself still answers 404 to anyone not on the allowlist.
 */
export const ADMIN_MANIFEST_PATH = "/admin.webmanifest";

export const ADMIN_ICONS = {
  apple: "/icons/admin/apple-touch-icon.png",
  favicon: "/icons/admin/icon-32.png",
} as const;

export function adminManifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "CELLR Admin",
    short_name: "CELLR Admin",
    description: "Run CELLR: wines, corrections, insights, architecture and health.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    // the same dark as the CELLR app's splash and the page's own dark theme colour
    background_color: "#0e090b",
    theme_color: "#0e090b",
    icons: [
      { src: "/icons/admin/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/admin/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/admin/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
