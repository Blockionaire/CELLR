import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RackBuilder } from "@/features/cellar/builder/rack-builder";
import { getPageContext } from "@/server/context";
import { getBuilderAccess } from "@/server/env";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  if (!getBuilderAccess().open) return {};
  return { title: (await getTranslations("builder"))("entryEdit"), robots: { index: false } };
}

/**
 * The Rack Builder for an existing place (sprint 3). The place itself is read through the Smart Cellar API, as the
 * signed-in person (another household's place is "not found" there, exactly as one that does not exist).
 */
export default async function PlaceBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = getBuilderAccess();
  if (!access.open) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await getPageContext();
  if (!ctx) return null;
  const query = await searchParams;
  return <RackBuilder placeId={id.toLowerCase()} access={access} justSaved={query.saved === "1"} />;
}
