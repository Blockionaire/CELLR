import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RetryButton } from "@/features/account/retry-button";
import { EmptyState } from "@/ui/empty-state";

export const metadata: Metadata = { title: "Offline" };

/** Served by the service worker when there is no connection. Public, static, precached. */
export default async function OfflinePage() {
  const t = await getTranslations("offline");
  return (
    <div className="grid min-h-dvh place-items-center">
      <EmptyState title={t("title")} body={t("body")} action={<RetryButton label={t("retry")} />} />
    </div>
  );
}
