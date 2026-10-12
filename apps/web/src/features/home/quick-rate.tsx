"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatStars } from "@cellr/domain";
import { useSaveTasting } from "@/features/cellar/hooks";
import { StarsInput } from "@/ui/stars";

/** Tap a star: that is the rating, saved straight away. (Words and a note live one tap further.) */
export function QuickRate({ bottleId }: { bottleId: string }) {
  const t = useTranslations("tasting");
  const save = useSaveTasting();
  const [score, setScore] = useState<number | null>(null);
  return (
    <StarsInput
      value={score}
      label={t("ratingLabel")}
      optionLabel={(s) => t("star", { stars: Number(formatStars(s)) })}
      onChange={(next) => {
        setScore(next);
        if (next !== null)
          save.mutate({ bottleId, tasting: { score: next, descriptors: [], note: null } });
      }}
    />
  );
}
