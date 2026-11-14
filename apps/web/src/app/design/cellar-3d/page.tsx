import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CellarGallery } from "@/features/design/cellar-gallery";
import { normalize } from "@/features/design/cellar-gallery-state";
import { isCellarGalleryEnabled } from "@/server/env";

/** Where the gallery is closed, not even its name is in the answer. */
export function generateMetadata(): Metadata {
  const robots = { index: false, follow: false };
  return isCellarGalleryEnabled() ? { title: "Storage templates", robots } : { robots };
}

/**
 * The template gallery of Smart Cellar 3D (sprint 2A). Local development, and Vercel preview deployments that ask
 * for it; never a production deployment, whatever is set there (see cellar-gallery-gate.ts, which is stricter than
 * the gate of /design). Where it is closed the app's "not found" page is shown and nothing of the gallery. It
 * reads no database and no session: every place and bottle on it is made up from numbers.
 */
export default async function CellarGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isCellarGalleryEnabled()) notFound();
  const params = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  return <CellarGallery initial={normalize(flat)} />;
}
