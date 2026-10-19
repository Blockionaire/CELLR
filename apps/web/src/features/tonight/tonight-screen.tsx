"use client";

import { useTranslations } from "next-intl";
import { SommelierChat } from "@/features/sommelier/sommelier-screen";

const DISHES = ["steak", "pasta", "fish", "curry", "cheese", "pizza", "celebrate", "sofa"] as const;

/**
 * "What shall we drink tonight?" as a conversation: name the dish or the evening, and the sommelier says
 * honestly which bottle from the cellar suits it — or that none does, and what to buy instead.
 */
export function TonightScreen({
  hasBottles,
  ask,
}: {
  hasBottles: boolean;
  /** A question to ask at once (from Home). */
  ask?: string | undefined;
}) {
  const t = useTranslations("tonight");
  return (
    <SommelierChat
      mode="tonight"
      title={t("title")}
      subtitle={hasBottles ? t("chatIntro") : t("chatIntroEmpty")}
      chips={DISHES.map((d) => t(`chatChips.${d}`))}
      hasBottles={hasBottles}
      initialQuestion={ask}
    />
  );
}
