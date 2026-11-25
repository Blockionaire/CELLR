import type { Metadata } from "next";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { isDomainError } from "@cellr/domain";
import { RecordScreen } from "@/features/wine-ratings/record-screen";
import { getPageContext } from "@/server/context";
import { getFeatures } from "@/server/env";
import { servicesFor } from "@/server/services";

type Props = { params: Promise<{ recordId: string }> };

// once per request: the metadata and the page share the answer
const load = cache(async (recordId: string) => {
  if (!getFeatures().catalog_ratings || !z.uuid().safeParse(recordId).success) notFound();
  const ctx = await getPageContext();
  if (!ctx) redirect("/sign-in");
  try {
    return await servicesFor(ctx).ratings.record(recordId);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await load((await params).recordId);
  return { title: `${r.producer} ${r.name}` };
}

/**
 * The catalogue page of a wine found in search or by a scan, before it is in any cellar (`catalog_ratings`): what the
 * source says it is, its ratings and reviews, and "add to my cellar". Only a record shown to people.
 */
export default async function CatalogRecordPage({ params }: Props) {
  const record = await load((await params).recordId);
  return <RecordScreen record={record} community={getFeatures().community_reviews} />;
}
