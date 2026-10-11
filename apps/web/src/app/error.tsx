"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";

/** Last-resort boundary. Never shows a stack trace or an error code — just a way forward. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");
  return (
    <div className="grid min-h-dvh place-items-center">
      <EmptyState
        title={t("title")}
        body={t("body")}
        action={
          <Button size="lg" onClick={reset}>
            {t("retry")}
          </Button>
        }
      />
    </div>
  );
}
