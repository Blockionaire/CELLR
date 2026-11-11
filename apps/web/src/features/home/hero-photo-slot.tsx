"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { BottlePhotoInvite } from "@cellr/domain";
import { BottlePhotoSheet } from "@/features/cellar/bottle-photo";
import { PlusIcon } from "@/ui/icons";

/**
 * The hero's empty place for a bottle, when no wine of the cellar has a 2D picture yet but the server invites photos
 * for one (the same invitation as Home's card, chosen and limited by the same rules: not dismissed, nothing sent for
 * it, never rewarded). A faint bottle outline with a plus: tapping it opens the very same bottle-photo sheet for that
 * wine. Once photos are sent it goes, for this visit.
 */
export function HeroPhotoSlot({ invite }: { invite: BottlePhotoInvite }) {
  const t = useTranslations("home");
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [gone, setGone] = useState(false);
  const wine = `${invite.producer} ${invite.wineName}`;
  return (
    <>
      {!gone && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={t("heroPhotoSlot", { wine })}
          data-testid="hero-photo-slot"
          className="group/slot relative z-10 flex shrink-0 flex-col items-center justify-end gap-1.5 self-end rounded-[20px] px-1.5 pb-1 pt-2 text-hero-ink/75 outline-none transition-transform duration-200 ease-spring hover:text-hero-ink active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-hero-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-from)] motion-reduce:transition-none"
        >
          <span className="relative block h-[8.25rem] w-[3.25rem] md:h-[10.5rem] md:w-[4rem]">
            {/* the outline of a bottle, waiting for its picture */}
            <svg
              viewBox="0 0 52 132"
              aria-hidden="true"
              focusable="false"
              className="absolute inset-0 size-full"
            >
              <path
                d="M21 4h10v30c0 6 15 14 15 30v58a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V64c0-16 15-24 15-30Z"
                fill="rgb(255 255 255 / 0.06)"
                stroke="currentColor"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <span className="absolute left-1/2 top-[58%] grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-hero-gold text-[#3a1119] shadow-[0_6px_14px_-4px_rgb(0_0_0/0.5)] transition-transform duration-200 ease-spring group-hover/slot:scale-105">
              <PlusIcon size={18} />
            </span>
          </span>
          <span aria-hidden="true" className="text-[0.6875rem] font-medium leading-none">
            {t("heroPhotoSlotShort")}
          </span>
        </button>
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
