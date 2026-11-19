"use client";

import { useTranslations } from "next-intl";
import type { SommelierSharingView } from "@cellr/domain";
import { useSaveSommelierSharing, useSommelierSharing } from "./hooks";
import { Card } from "./person";

/**
 * My own consent for the social sommelier: whether a friend's sommelier may take my taste into account when
 * they name me in a question. Apart from showing my taste profile to friends, and off until I turn it on. The
 * text says exactly what is used and what is not.
 */
export function SommelierSharingCard({ initial }: { initial: SommelierSharingView | null }) {
  const t = useTranslations("friends");
  const sharing = useSommelierSharing(initial);
  const save = useSaveSommelierSharing();
  const allowed = sharing.data?.tasteForFriends ?? initial?.tasteForFriends ?? false;
  return (
    <Card
      title={t("sommelierSharing.title")}
      testId="sommelier-sharing"
      aside={
        <button
          type="button"
          role="switch"
          aria-checked={allowed}
          aria-label={t("sommelierSharing.title")}
          aria-describedby="sommelier-sharing-body"
          disabled={save.isPending || sharing.isLoading}
          onClick={() => save.mutate({ tasteForFriends: !allowed })}
          className={
            "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150 ease-cellr focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg disabled:opacity-60 " +
            (allowed ? "bg-accent" : "bg-raised ring-1 ring-hairline")
          }
        >
          <span
            aria-hidden="true"
            className={
              "absolute top-1 size-5 rounded-full bg-surface shadow-raised transition-[left] duration-150 ease-cellr " +
              (allowed ? "left-6" : "left-1")
            }
          />
        </button>
      }
    >
      <p id="sommelier-sharing-body" className="text-small text-ink-2">
        {t("sommelierSharing.body")}
      </p>
      <p className="mt-2 text-small text-ink-3">{t("sommelierSharing.never")}</p>
    </Card>
  );
}
