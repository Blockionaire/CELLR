import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isDomainError } from "@cellr/domain";
import { VintageScreen } from "@/features/cellar/vintage-screen";
import { getPageContext } from "@/server/context";
import { getPageMe } from "@/server/me";
import { servicesFor } from "@/server/services";

type Props = {
  params: Promise<{ vintageId: string }>;
  searchParams: Promise<{ rate?: string; pick?: string }>;
};

async function load(vintageId: string) {
  if (!z.uuid().safeParse(vintageId).success) notFound();
  const ctx = await getPageContext();
  if (!ctx) return null; // the (app) layout has already redirected signed-out visitors
  try {
    return await servicesFor(ctx).cellar.vintage(vintageId);
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await load((await params).vintageId);
  return { title: detail ? `${detail.wine.producer} ${detail.wine.name}` : "Cellar" };
}

export default async function VintagePage({ params, searchParams }: Props) {
  const { vintageId } = await params;
  const { rate, pick } = await searchParams;
  const [detail, me] = await Promise.all([load(vintageId), getPageMe()]);
  if (!detail) return null;
  const currency = me?.households.find((h) => h.id === me.activeHouseholdId)?.currency ?? "EUR";
  return (
    <VintageScreen
      initial={detail}
      currency={currency}
      initialRate={rate}
      initialPick={pick === "1"}
    />
  );
}
