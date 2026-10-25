"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  coarseDevice,
  ERROR_MESSAGES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  FEEDBACK_PLACES,
  type FeedbackCategory,
  type FeedbackPlace,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { CheckIcon, ChevronRightIcon } from "@/ui/icons";
import { Sheet } from "@/ui/sheet";
import { Textarea } from "@/ui/textarea";
import { useSendFeedback } from "./hooks";

/** The coarse device line, read only in the browser (and only shown, never sent, until the person ticks it). */
const noop = () => () => {};
const readDevice = () =>
  coarseDevice(
    navigator.userAgent,
    window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  );

/** In Profile: the way to tell us what went wrong, what confused you, or what you would like. */
export function FeedbackEntry() {
  const t = useTranslations("feedback");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="feedback-entry"
        className="flex w-full items-center justify-between gap-3 rounded-card bg-surface p-5 text-left shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.99] motion-reduce:transition-none md:p-6"
      >
        <span className="min-w-0">
          <span className="block font-display text-title">{t("entryTitle")}</span>
          <span className="mt-1 block text-small text-ink-2">{t("entryBody")}</span>
        </span>
        <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
      </button>
      <FeedbackSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("feedback");
  const te = useTranslations();
  const send = useSendFeedback();
  const device = useSyncExternalStore(noop, readDevice, () => "");
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [place, setPlace] = useState<FeedbackPlace | "">("");
  const [withDevice, setWithDevice] = useState(false);
  const [checked, setChecked] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // One send at a time: a double tap never sends the same report twice.
  const sending = useRef(false);

  const tooShort = message.trim().length < FEEDBACK_MESSAGE_MIN;

  function reset() {
    setCategory(null);
    setMessage("");
    setPlace("");
    setWithDevice(false);
    setChecked(false);
    setFailure(null);
    send.reset();
  }

  function close() {
    onClose();
    if (sent) {
      setSent(false);
      reset();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (!category || tooShort || sending.current) return;
    sending.current = true;
    setFailure(null);
    try {
      await send.mutateAsync({
        category,
        message,
        location: place || null,
        device: withDevice && device ? device : null,
      });
      setSent(true);
    } catch (e) {
      setFailure(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    } finally {
      sending.current = false;
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("title")}
      description={sent ? undefined : t("intro")}
    >
      {sent ? (
        <div role="status" className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-ink">
            <CheckIcon size={22} />
          </span>
          <p className="font-display text-title text-ink">{t("thanksTitle")}</p>
          <p className="text-small text-ink-2">{t("thanksBody")}</p>
          <div className="flex w-full flex-col gap-2">
            <Button size="lg" block onClick={close}>
              {t("done")}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              block
              onClick={() => {
                setSent(false);
                reset();
              }}
            >
              {t("another")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-small font-medium text-ink-2">{t("categoryLabel")}</legend>
            <div role="radiogroup" aria-label={t("categoryLabel")} className="flex flex-wrap gap-2">
              {FEEDBACK_CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  role="radio"
                  aria-pressed={undefined}
                  aria-checked={category === c}
                  selected={category === c}
                  onClick={() => setCategory(c)}
                >
                  {t(`category.${c}`)}
                </Chip>
              ))}
            </div>
            {checked && !category && (
              <p role="alert" className="mt-2 text-small text-danger">
                {t("categoryError")}
              </p>
            )}
          </fieldset>

          <div>
            <Textarea
              label={t("messageLabel")}
              placeholder={t("messagePlaceholder")}
              maxLength={FEEDBACK_MESSAGE_MAX}
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              error={checked && tooShort ? t("messageError", { min: FEEDBACK_MESSAGE_MIN }) : null}
            />
            <p className="mt-1.5 text-caption text-ink-3">{t("sensitive")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="feedback-place" className="text-small font-medium text-ink-2">
              {t("placeLabel")}
            </label>
            <select
              id="feedback-place"
              value={place}
              onChange={(e) => setPlace(e.target.value as FeedbackPlace | "")}
              className="min-h-12 rounded-control border border-hairline bg-surface px-4 text-body text-ink focus-visible:border-accent-fg focus-visible:outline-none"
            >
              <option value="">{t("placeNone")}</option>
              {FEEDBACK_PLACES.map((p) => (
                <option key={p} value={p}>
                  {t(`place.${p}`)}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-3 rounded-[16px] bg-raised p-3 text-small text-ink">
            <input
              type="checkbox"
              checked={withDevice}
              onChange={(e) => setWithDevice(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent-fg)]"
            />
            <span>
              {t("deviceLabel")}
              <span className="mt-0.5 block text-caption text-ink-2" data-testid="device-preview">
                {device || "—"}
              </span>
            </span>
          </label>

          {failure && (
            <div
              role="alert"
              className="rounded-[16px] bg-raised p-3 text-small text-ink ring-1 ring-hairline"
            >
              <p>
                {t("failed")} {failure}
              </p>
              <p className="mt-1 text-ink-2">{t("failedKept")}</p>
            </div>
          )}

          <Button type="submit" size="lg" block loading={send.isPending}>
            {failure ? t("retry") : t("submit")}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
