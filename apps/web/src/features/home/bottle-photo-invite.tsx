"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BOTTLE_PHOTO_POINTS, formatVintage, type BottlePhotoInvite } from "@cellr/domain";
import { BottlePhotoSheet, RewardPill } from "@/features/cellar/bottle-photo";
import { WinePicture } from "@/features/cellar/wine-picture";
import { api } from "@/lib/api";
import { Button } from "@/ui/button";

/**
 * One quiet invitation on Home to picture a wine of the cellar (chosen by the server: no 2D picture yet, own or
 * inherited; nothing sent for it by me; never rewarded for it; the most recently added first). The button opens the
 * bottle-photo sheet for exactly that wine. "Not now" hides it for 30 days on every device; once photos are sent it
 * goes for this visit (the next wine, if any, comes another time, never right away).
 */
export function BottlePhotoInviteCard({ invite }: { invite: BottlePhotoInvite }) {
  const t = useTranslations("bottlePhoto");
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const [sent, setSent] = useState(false);
  if (gone && !open) return null;
  const wine = `${invite.producer} ${invite.wineName}`;
  return (
    <>
      {!gone && (
        <section
          className="reveal mt-10 flex items-start gap-4 rounded-card bg-surface p-3 pr-4 ring-1 ring-hairline"
          aria-labelledby="bottle-photo-invite"
          data-testid="bottle-photo-invite"
        >
          <WinePicture
            wine={{
              vintageId: invite.vintageId,
              type: invite.type,
              producer: invite.producer,
              wineName: invite.wineName,
              year: invite.year,
              image: null,
            }}
            className="h-[6.5rem] w-[4.75rem] shrink-0 rounded-[16px]"
          />
          <div className="min-w-0 flex-1">
            <p className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
              {t("inviteEyebrow")}
            </p>
            <h2 id="bottle-photo-invite" className="font-display text-title text-ink text-balance">
              {invite.wineName}
            </h2>
            <p className="truncate text-small text-ink-2">
              {invite.producer} · <span className="tnum">{formatVintage(invite.year)}</span>
            </p>
            <p className="mt-1.5 text-small text-ink-2 text-pretty">
              {t("inviteBody", { wine: invite.wineName })}{" "}
              <RewardPill points={BOTTLE_PHOTO_POINTS} />
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setOpen(true)}>
                {t("inviteCta")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGone(true);
                  // best effort: if it fails, the card is simply back on the next visit
                  void api.delete("/bottle-photos/invite").catch(() => {});
                }}
              >
                {t("inviteLater")}
              </Button>
            </div>
          </div>
        </section>
      )}
      <BottlePhotoSheet
        open={open}
        onClose={() => {
          setOpen(false);
          if (sent) setGone(true);
        }}
        onSent={() => setSent(true)}
        vintageId={invite.vintageId}
        wine={wine}
      />
    </>
  );
}
