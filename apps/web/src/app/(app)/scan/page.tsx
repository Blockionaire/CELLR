import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/ui/empty-state";
import { PageHeader } from "@/ui/page-header";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("scan"))("title") };
}

export default async function ScanPage() {
  const t = await getTranslations("scan");
  return (
    <>
      <PageHeader title={t("title")} />
      <EmptyState title={t("soonTitle")} body={t("soonBody")} />
    </>
  );
}
