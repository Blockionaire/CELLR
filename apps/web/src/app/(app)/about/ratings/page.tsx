import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/ui/page-header";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("aboutRatings"))("title") };
}

/**
 * The ONE central page that credits the external ratings and explains the CELLR score (owner's permission: no credit
 * on every wine card; SOURCE_RIGHTS_REGISTER.md §1b). The X-Wines citation the authors require is given here.
 */
export default async function AboutRatingsPage() {
  const t = await getTranslations("aboutRatings");
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      <section className="border-t border-hairline py-6">
        <h2 className="font-serif text-title text-ink">{t("methodTitle")}</h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body text-ink-2">
          {(["method1", "method2", "method3", "method4", "method5"] as const).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </section>
      <section className="border-t border-hairline py-6">
        <h2 className="font-serif text-title text-ink">{t("externalTitle")}</h2>
        <p className="mt-3 text-body text-ink-2">{t("externalBody")}</p>
        <blockquote className="mt-4 rounded-card bg-surface p-4 text-small text-ink-2 ring-1 ring-hairline">
          {t("citation")}{" "}
          <a
            href="https://doi.org/10.3390/bdcc7010020"
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="text-accent-fg underline underline-offset-4"
          >
            {t("citationLink")}
          </a>
        </blockquote>
      </section>
      <section className="border-t border-hairline py-6">
        <h2 className="font-serif text-title text-ink">{t("communityTitle")}</h2>
        <p className="mt-3 text-body text-ink-2">{t("communityBody")}</p>
      </section>
      <section className="border-t border-hairline py-6">
        <h2 className="font-serif text-title text-ink">{t("matchTitle")}</h2>
        <p className="mt-3 text-body text-ink-2">{t("matchBody")}</p>
      </section>
    </div>
  );
}
