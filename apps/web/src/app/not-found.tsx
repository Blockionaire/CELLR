import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonStyles } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <div className="grid min-h-dvh place-items-center">
      <EmptyState
        title={t("title")}
        body={t("body")}
        action={
          <Link href="/" className={buttonStyles({ size: "lg" })}>
            {t("home")}
          </Link>
        }
      />
    </div>
  );
}
