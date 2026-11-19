import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RackBuilder } from "@/features/cellar/builder/rack-builder";
import { getPageContext } from "@/server/context";
import { getBuilderAccess } from "@/server/env";

/** Where the builder is closed, not even its name is in the answer. */
export async function generateMetadata(): Promise<Metadata> {
  if (!getBuilderAccess().open) return {};
  return { title: (await getTranslations("builder"))("titleNew"), robots: { index: false } };
}

/**
 * The Rack Builder, for a new place (Smart Cellar 3D, sprint 3). Behind its own server gate
 * (lib/smart-cellar-builder-gate.ts): closed, this page is "not found", and nothing of the builder is downloaded.
 */
export default async function NewPlaceBuilderPage() {
  const access = getBuilderAccess();
  if (!access.open) notFound();
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  return <RackBuilder placeId={null} access={access} />;
}
