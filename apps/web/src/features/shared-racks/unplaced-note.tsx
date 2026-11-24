"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatVintage } from "@cellr/domain";
import { useRacks } from "@/features/cellar/hooks";
import { Button } from "@/ui/button";
import { useToast } from "@/ui/toast";
import { useMySharedBottles, useWithdrawBottle } from "./hooks";
import { PeopleIcon } from "./icons";
import { useErrorText } from "./sheets";

/**
 * MY OWN CELLAR, KEPT HONEST. A bottle of mine that stands in a shared rack has no place in my own cellar, so my
 * cellar lists it as "not placed yet". That would be untrue by omission: it has a place. This says which of those
 * bottles stand in a shared rack and where (the rack and the spot only while I am a member of it), with the way to
 * open the rack, and the way to say "it is no longer there", which I always keep, member or not.
 *
 * Shows nothing at all when none of my bottles stands in a shared rack.
 */
export function SharedRackUnplacedNote({
  onOpen,
}: {
  onOpen?: ((rackId: string) => void) | undefined;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const toast = useToast();
  const say = useErrorText();
  const mine = useMySharedBottles();
  const racks = useRacks(true);
  const withdraw = useWithdrawBottle();
  const [confirming, setConfirming] = useState<string | null>(null);
  const bottles = mine.data?.bottles ?? [];
  if (bottles.length === 0) return null;
  const names = new Map(
    (racks.data?.unplaced ?? []).map((b) => [
      b.bottleId,
      `${b.producer} ${b.wineName} ${formatVintage(b.year)}`,
    ]),
  );
  return (
    <section
      className="flex flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-hairline"
      data-testid="shared-rack-unplaced-note"
      aria-labelledby="sr-unplaced-h"
    >
      <h2 id="sr-unplaced-h" className="flex items-center gap-2 text-small font-medium text-ink">
        <PeopleIcon size={18} className="shrink-0 text-ink-2" />
        {t("unplaced.title", { count: bottles.length })}
      </h2>
      <p className="text-small text-ink-2">{t("unplaced.what")}</p>
      <ul className="flex flex-col gap-2">
        {bottles.map((b) => {
          const wine = names.get(b.bottleId) ?? t("aBottle");
          return (
            <li
              key={b.bottleId}
              data-testid="shared-rack-unplaced-bottle"
              data-bottle={b.bottleId}
              data-access={b.hasAccess ? "true" : "false"}
              className="flex flex-col gap-2"
            >
              <span className="text-small text-ink">
                {b.hasAccess && b.spot
                  ? t("unplaced.line", {
                      wine,
                      rack: b.rackName ?? "",
                      row: b.spot.row,
                      col: b.spot.col,
                    })
                  : t("unplaced.lineNoAccess", { wine })}
              </span>
              {confirming === b.bottleId ? (
                <div className="flex flex-col gap-2 rounded-card bg-raised p-3">
                  <p className="text-small text-ink">{t("unplaced.withdrawWhat", { wine })}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="md"
                      loading={withdraw.isPending}
                      data-testid="shared-rack-withdraw-confirm"
                      onClick={() =>
                        withdraw.mutate(b.bottleId, {
                          onSuccess: () => {
                            setConfirming(null);
                            toast.show(t("unplaced.withdrawn", { wine }));
                          },
                          onError: (e) => {
                            setConfirming(null);
                            toast.show(say(e), { tone: "error" });
                          },
                        })
                      }
                    >
                      {t("unplaced.withdrawConfirm")}
                    </Button>
                    <Button size="md" variant="ghost" onClick={() => setConfirming(null)}>
                      {tc("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {onOpen && b.hasAccess && b.rackId && (
                    <Button
                      size="md"
                      variant="secondary"
                      onClick={() => onOpen(b.rackId!)}
                      data-testid="shared-rack-unplaced-open"
                    >
                      {t("unplaced.open")}
                    </Button>
                  )}
                  <Button
                    size="md"
                    variant="ghost"
                    onClick={() => setConfirming(b.bottleId)}
                    data-testid="shared-rack-withdraw"
                  >
                    {t("unplaced.withdraw")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
