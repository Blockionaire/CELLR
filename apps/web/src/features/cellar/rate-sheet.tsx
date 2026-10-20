"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  DESCRIPTORS,
  ERROR_MESSAGES,
  MAX_NOTE_LENGTH,
  formatStars,
  type Descriptor,
  type TastingView,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Sheet } from "@/ui/sheet";
import { StarsInput } from "@/ui/stars";
import { Textarea } from "@/ui/textarea";
import { useDeleteTasting, useSaveTasting } from "./hooks";

interface RateSheetProps {
  open: boolean;
  onClose: () => void;
  /** The opened bottle being talked about. */
  bottleId: string;
  /** "Pavillon Rouge 2015". */
  title: string;
  /** What this person said before, if anything: the sheet then edits it. */
  existing: TastingView | null;
}

/**
 * "How was it?": stars in halves, a few words, a note. Mounted again (keyed) for each bottle, so what was
 * typed for one never leaks into the next.
 */
export function RateSheet({ open, onClose, bottleId, title, existing }: RateSheetProps) {
  const t = useTranslations("tasting");
  const te = useTranslations();
  const save = useSaveTasting();
  const remove = useDeleteTasting();
  const [score, setScore] = useState<number | null>(existing?.score ?? null);
  const [words, setWords] = useState<Descriptor[]>(existing?.descriptors ?? []);
  const [note, setNote] = useState(existing?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [askRemove, setAskRemove] = useState(false);

  const hasSomething = score !== null || words.length > 0 || note.trim() !== "";
  const busy = save.isPending || remove.isPending;
  const fail = (e: unknown) => setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));

  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={title}>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hasSomething) return setError(t("needSomething"));
          setError(null);
          save.mutate(
            {
              bottleId,
              tasting: { score, descriptors: words, note: note.trim() === "" ? null : note },
            },
            {
              onSuccess: onClose,
              onError: fail,
            },
          );
        }}
      >
        <div className="flex flex-col items-center gap-2 py-2">
          <StarsInput
            value={score}
            onChange={setScore}
            label={t("ratingLabel")}
            optionLabel={(s) => t("star", { stars: Number(formatStars(s)) })}
          />
          <p className="h-5 text-small text-ink-2" aria-live="polite">
            {score === null ? "" : t("rated", { stars: formatStars(score) })}
          </p>
        </div>

        <section>
          <h3 className="mb-2.5 text-small font-medium text-ink-2">{t("wordsTitle")}</h3>
          <div className="flex flex-wrap gap-2">
            {DESCRIPTORS.map((d) => (
              <Chip
                key={d}
                selected={words.includes(d)}
                onClick={() =>
                  setWords((list) =>
                    list.includes(d) ? list.filter((x) => x !== d) : [...list, d],
                  )
                }
              >
                {t(`descriptors.${d}`)}
              </Chip>
            ))}
          </div>
        </section>

        <Textarea
          label={t("noteLabel")}
          placeholder={t("notePlaceholder")}
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(e) => setNote(e.target.value)}
        />

        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block loading={save.isPending} disabled={busy}>
          {t("save")}
        </Button>
        {existing && (
          <div className="text-center">
            {/* Stars, words and note go at once and can't be undone: the first tap asks. */}
            {askRemove ? (
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(bottleId, {
                    onSuccess: onClose,
                    onError: fail,
                  })
                }
              >
                {t("removeConfirm")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setAskRemove(true)}
              >
                {t("remove")}
              </Button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
}
