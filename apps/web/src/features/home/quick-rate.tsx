"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatStars } from "@cellr/domain";
import { useSaveTasting } from "@/features/cellar/hooks";
import { StarsInput } from "@/ui/stars";

/** Tap or slide across the stars: the rating is saved when you let go. (Words and a note live one tap further.) */
export function QuickRate({ bottleId }: { bottleId: string }) {
  const t = useTranslations("tasting");
  const save = useSaveTasting();
  const [score, setScore] = useState<number | null>(null);
  // A slide commits once, on release; arrow keys commit on every press, so a burst of them saves once.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(pending.current ?? undefined), []);
  return (
    <StarsInput
      value={score}
      label={t("ratingLabel")}
      emptyLabel={t("notRated")}
      optionLabel={(s) => t("star", { stars: Number(formatStars(s)) })}
      onChange={setScore}
      onCommit={(next) => {
        clearTimeout(pending.current ?? undefined);
        if (next === null) return;
        pending.current = setTimeout(
          () => save.mutate({ bottleId, tasting: { score: next, descriptors: [], note: null } }),
          500,
        );
      }}
    />
  );
}
