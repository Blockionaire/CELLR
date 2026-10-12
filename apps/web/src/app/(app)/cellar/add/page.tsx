import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { AddBottleFlow } from "@/features/cellar/add-bottle-flow";
import { getPageContext } from "@/server/context";
import { getPageMe } from "@/server/me";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("addBottle"))("eyebrow") };
}

type Props = {
  searchParams: Promise<{ wine?: string; year?: string; nv?: string; wish?: string }>;
};

export default async function AddBottlePage({ searchParams }: Props) {
  const { wine: wineParam, year: yearParam, nv, wish } = await searchParams;
  const [me, ctx] = await Promise.all([getPageMe(), getPageContext()]);
  const currency = me?.households.find((h) => h.id === me.activeHouseholdId)?.currency ?? "EUR";

  // "Add more" from a wine's page arrives with the wine (and vintage) already chosen.
  const wineId = z.uuid().safeParse(wineParam);
  const initialWine =
    ctx && wineId.success
      ? (await servicesFor(ctx).cellar.wines()).find((w) => w.id === wineId.data)
      : undefined;
  const year = /^\d{4}$/.test(yearParam ?? "") ? Number(yearParam) : undefined;
  const initialYear = nv === "1" ? null : year;

  const wishId = z.uuid().safeParse(wish);

  return (
    <AddBottleFlow
      currency={currency}
      initialWine={initialWine}
      initialYear={initialYear}
      wishId={wishId.success ? wishId.data : undefined}
    />
  );
}
