import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/ui/empty-state";
import { PageHeader } from "@/ui/page-header";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("sommelier"))("title") };
}

export default async function SommelierPage() {
  const t = await getTranslations("sommelier");
  return (
    <>
      <PageHeader title={t("title")} />
      <EmptyState title={t("soonTitle")} body={t("soonBody")} />
    </>
  );
}
