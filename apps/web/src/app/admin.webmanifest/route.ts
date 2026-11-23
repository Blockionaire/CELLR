import { adminManifest } from "@/features/admin/admin-manifest";

/**
 * GET /admin.webmanifest: the CELLR Admin web app's manifest (features/admin/admin-manifest.ts). Served explicitly,
 * because Next's manifest file convention makes one manifest for the whole site. Static and public, like
 * /manifest.webmanifest: it holds no admin data.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(adminManifest()), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
