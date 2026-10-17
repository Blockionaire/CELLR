"use client";

import { useTranslations } from "next-intl";
import type { AcquiredHow, BottleExtrasInput } from "@cellr/domain";
import { Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";

export interface ExtrasDraft {
  acquiredHow: AcquiredHow | "";
  giftFrom: string;
  occasionTitle: string;
  occasionOn: string;
}

export const EMPTY_DRAFT: ExtrasDraft = {
  acquiredHow: "",
  giftFrom: "",
  occasionTitle: "",
  occasionOn: "",
};

/** The draft as the API wants it: empty things are nulls. */
export const draftToInput = (d: ExtrasDraft): BottleExtrasInput => ({
  acquiredHow: d.acquiredHow === "" ? null : d.acquiredHow,
  giftFrom: d.giftFrom,
  occasionTitle: d.occasionTitle,
  occasionOn: d.occasionOn === "" ? null : d.occasionOn,
});

export const hasDraft = (d: ExtrasDraft) =>
  d.acquiredHow !== "" || d.occasionTitle.trim() !== "" || d.occasionOn !== "";

/** Bought or a gift (and from whom), and whether it is being kept for a day. Shared by "add" and "this bottle". */
export function ExtrasFields({
  value,
  onChange,
  error,
}: {
  value: ExtrasDraft;
  onChange: (next: ExtrasDraft) => void;
  error?: string | null;
}) {
  const t = useTranslations("bottleExtras");
  const set = (patch: Partial<ExtrasDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <Segmented<AcquiredHow | "">
        label={t("howLabel")}
        value={value.acquiredHow}
        onChange={(acquiredHow) => set({ acquiredHow })}
        options={[
          { value: "", label: t("howUnknown") },
          { value: "bought", label: t("howBought") },
          { value: "gift", label: t("howGift") },
        ]}
        className="self-start"
      />
      {value.acquiredHow === "gift" && (
        <Field
          inputClassName="rounded-full px-5"
          label={t("giftFromLabel")}
          placeholder={t("giftFromPlaceholder")}
          maxLength={120}
          value={value.giftFrom}
          onChange={(e) => set({ giftFrom: e.target.value })}
        />
      )}
      <Field
        inputClassName="rounded-full px-5"
        label={t("occasionLabel")}
        placeholder={t("occasionPlaceholder")}
        maxLength={120}
        value={value.occasionTitle}
        onChange={(e) =>
          // No occasion, no day: the date field goes away with the words, so it must not linger unseen.
          set(
            e.target.value.trim() === ""
              ? { occasionTitle: e.target.value, occasionOn: "" }
              : { occasionTitle: e.target.value },
          )
        }
        error={error}
      />
      {value.occasionTitle.trim() !== "" && (
        <Field
          inputClassName="rounded-full px-5"
          label={t("occasionDateLabel")}
          hint={t("occasionHint")}
          type="date"
          value={value.occasionOn}
          onChange={(e) => set({ occasionOn: e.target.value })}
        />
      )}
    </div>
  );
}
