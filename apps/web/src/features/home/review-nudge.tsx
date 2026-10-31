"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatVintage, type OpenedEntry } from "@cellr/domain";
import { RateSheet } from "@/features/cellar/rate-sheet";
import { WinePicture } from "@/features/cellar/wine-picture";
import { Button } from "@/ui/button";

/**
 * "How was the Pavillon Rouge?": a bottle opened in the last few days that I have not said anything about yet. The
 * button opens the whole review (stars in tenths, words, a note) right here over Home. Nothing is saved until "Save
 * review": opening the sheet, touching the stars or closing it again writes nothing. Once saved, Home refreshes and
 * this question is gone (Home only asks about bottles I have not reviewed, so there is never a review to overwrite).
 */
export function ReviewNudge({ entry, when }: { entry: OpenedEntry; when: string }) {
  const t = useTranslations("home");
  const [open, setOpen] = useState(false);
  const vintage = formatVintage(entry.year);
  return (
    <section
      className="reveal mt-5 flex items-start gap-4 rounded-card bg-surface p-3 pr-4 shadow-raised ring-1 ring-hairline"
      aria-labelledby="rate-nudge"
      data-testid="rate-nudge"
    >
      <WinePicture
        wine={{
          vintageId: entry.vintageId,
          type: entry.type,
          producer: entry.producer,
          wineName: entry.wineName,
          year: entry.year,
          image: null,
        }}
        className="h-[6.5rem] w-[4.75rem] shrink-0 rounded-[16px]"
      />
      <div className="min-w-0 flex-1">
        <p className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
          {t("nudgeWhen", { when })}
        </p>
        <h2 id="rate-nudge" className="font-display text-title text-ink text-balance">
          {t("nudge", { wine: entry.wineName })}
        </h2>
        <p className="truncate text-small text-ink-2">
          {entry.producer} · <span className="tnum">{vintage}</span>
        </p>
        <Button size="sm" className="mt-2.5" onClick={() => setOpen(true)}>
          {t("nudgeReview")}
        </Button>
      </div>
      {open && (
        <RateSheet
          key={entry.bottleId}
          open
          onClose={() => setOpen(false)}
          bottleId={entry.bottleId}
          title={`${entry.wineName} ${vintage}`}
          existing={null}
        />
      )}
    </section>
  );
}
