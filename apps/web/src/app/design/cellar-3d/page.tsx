import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CellarGallery } from "@/features/design/cellar-gallery";
import { normalize } from "@/features/design/cellar-gallery-state";
import { isDesignGalleryEnabled } from "@/server/env";

/** Where the gallery is closed, not even its name is in the answer. */
export function generateMetadata(): Metadata {
  const robots = { index: false, follow: false };
  return isDesignGalleryEnabled() ? { title: "Storage templates", robots } : { robots };
}

/**
 * The template gallery of Smart Cellar 3D (sprint 2A). Development and preview deployments only: in production it
 * does not exist (404) unless DESIGN_GALLERY=1 is set, exactly as /design. It reads no database and no session:
 * every place and bottle on it is made up from numbers.
 */
export default async function CellarGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isDesignGalleryEnabled()) notFound();
  const params = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  return <CellarGallery initial={normalize(flat)} />;
}
