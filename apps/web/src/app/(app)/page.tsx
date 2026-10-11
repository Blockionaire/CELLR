import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Greeting } from "@/features/account/greeting";
import { getPageMe } from "@/server/me";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { buttonStyles } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
import { EmptyState } from "@/ui/empty-state";

export default async function HomePage() {
  const me = await getPageMe();
  if (!me) redirect("/sign-in");
  const t = await getTranslations("home");

  return (
    <div className="pt-10 lg:pt-14">
      <h1 className="font-display text-headline text-ink-2">
        <Greeting name={me.displayName} />
      </h1>

      {/* The one big question. Everything else on Home is secondary to it. */}
      <Link
        href="/sommelier"
        className="group relative mt-6 block overflow-hidden rounded-card border border-hairline bg-surface p-6 transition-transform duration-200 ease-cellr active:scale-[0.99] md:p-8"
      >
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-bronze">
          {t("heroEyebrow")}
        </p>
        <h2 className="mt-3 max-w-[14ch] font-display text-display text-balance md:max-w-[18ch]">
          {t("heroTitle")}
        </h2>
        <p className="mt-3 max-w-[17rem] text-body text-ink-2">{t("heroEmpty")}</p>
        <span className="mt-6 inline-flex items-center gap-1 text-small font-medium text-accent-fg">
          {t("heroCta")}
          <ChevronRightIcon
            size={18}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </span>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-6 right-5 flex items-end gap-2 opacity-70 md:right-10"
        >
          <BottleGlyph shape="bordeaux" tint="red" className="w-8 -rotate-6 md:w-10" />
          <BottleGlyph shape="burgundy" tint="white" className="w-9 md:w-11" />
        </div>
      </Link>

      <EmptyState
        className="mt-6"
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <Link href="/scan" className={buttonStyles({ variant: "primary", size: "lg" })}>
            {t("emptyAction")}
          </Link>
        }
      />
    </div>
  );
}
