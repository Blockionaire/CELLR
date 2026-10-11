import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonStyles } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { PageHeader } from "@/ui/page-header";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("cellar"))("title") };
}

export default async function CellarPage() {
  const t = await getTranslations("cellar");
  return (
    <>
      <PageHeader title={t("title")} />
      <EmptyState
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <Link href="/scan" className={buttonStyles({ variant: "primary", size: "lg" })}>
            {t("emptyAction")}
          </Link>
        }
      />
    </>
  );
}
