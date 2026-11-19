"use client";

import { useTranslations } from "next-intl";
import { PAIRING_ENJOYED, type PairingEnjoyed, type SommelierOutcome } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { useToast } from "@/ui/toast";
import { useSetOutcome } from "./hooks";

/**
 * WHAT CAME OF A BOTTLE the sommelier offered: three separate things a person may say, each only when the one
 * before it is so. "I opened it"; "with the dish" or not; and, only for someone who had the two together, how
 * they went. None of it rates the answer (the thumbs do that), and a thumb is never read as any of this.
 *
 * Each step is a choice that stays visible and can be changed; "I did not open it" takes everything back.
 */
export function PickOutcome({
  messageId,
  vintageId,
  outcome,
  pairing,
}: {
  messageId: string;
  vintageId: string;
  /** What was said so far; null when nothing was. */
  outcome: SommelierOutcome | null;
  /** The answer was about a dish: only then is "with the dish" a question. */
  pairing: boolean;
}) {
  const t = useTranslations("sommelier.plan.said");
  const toast = useToast();
  const set = useSetOutcome(messageId, () => toast.show(t("failed"), { tone: "error" }));
  const say = (next: {
    opened: boolean;
    withDish?: boolean | null;
    enjoyed?: PairingEnjoyed | null;
  }) =>
    set.mutate({
      messageId,
      vintageId,
      opened: next.opened,
      withDish: next.withDish ?? null,
      enjoyed: next.enjoyed ?? null,
    });

  if (!outcome)
    return (
      <div className="px-1" data-testid="pick-outcome">
        <Choice label={t("open")} pressed={false} onClick={() => say({ opened: true })} />
      </div>
    );
  return (
    <div
      role="group"
      aria-label={t("label")}
      data-testid="pick-outcome"
      className="flex flex-col gap-2 px-1"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Choice label={t("open")} pressed onClick={() => say({ opened: false })} />
        <span className="text-caption text-ink-3">{t("undoHint")}</span>
      </div>
      {pairing && (
        <div role="group" aria-label={t("withDishQ")} className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-2">{t("withDishQ")}</span>
          <Choice
            label={t("yes")}
            pressed={outcome.withDish === true}
            onClick={() => say({ opened: true, withDish: outcome.withDish === true ? null : true })}
          />
          <Choice
            label={t("no")}
            pressed={outcome.withDish === false}
            onClick={() =>
              say({ opened: true, withDish: outcome.withDish === false ? null : false })
            }
          />
        </div>
      )}
      {pairing && outcome.withDish === true && (
        <div role="group" aria-label={t("enjoyedQ")} className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-2">{t("enjoyedQ")}</span>
          {PAIRING_ENJOYED.map((value) => (
            <Choice
              key={value}
              label={t(`enjoyed.${value}`)}
              pressed={outcome.enjoyed === value}
              onClick={() =>
                say({
                  opened: true,
                  withDish: true,
                  enjoyed: outcome.enjoyed === value ? null : value,
                })
              }
            />
          ))}
        </div>
      )}
      {outcome.enjoyed !== null && <p className="text-caption text-ink-3">{t("noted")}</p>}
    </div>
  );
}

/** A choice that stays: announced as pressed or not, and pressed again it is taken back. */
function Choice({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full border px-4 text-small font-medium transition-colors duration-150 ease-cellr active:scale-[0.97]",
        pressed
          ? "border-accent bg-accent text-accent-ink"
          : "border-hairline bg-surface text-ink-2 hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}
