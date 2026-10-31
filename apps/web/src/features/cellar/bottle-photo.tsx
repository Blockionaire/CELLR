"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ERROR_MESSAGES, type BottlePhotoResult } from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { preparePhoto, UnreadablePhotoError } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { Sheet } from "@/ui/sheet";

interface Picked {
  file: File;
  url: string;
}

/** Sends one bottle photo with the explicit yes; my points refresh after. */
function useSendBottlePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vintageId, file }: { vintageId: string; file: File }) => {
      const prepared = await preparePhoto(file);
      const form = new FormData();
      form.set("photo", prepared.photo, "bottle.jpg");
      form.set("vintageId", vintageId);
      form.set("consent", "true");
      return api.upload<BottlePhotoResult>("/bottle-photos", form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["points"] }),
  });
}

/**
 * Helping CELLR picture a wine: a photo of the whole bottle, sent only with the person's explicit yes that CELLR may
 * use it to make and show a 2D bottle picture of this wine. The photo itself is never shown in the app. The first
 * photo of a wine earns points; another one is welcome and says so.
 */
export function BottlePhotoContribution({ vintageId, wine }: { vintageId: string; wine: string }) {
  const t = useTranslations("bottlePhoto");
  const te = useTranslations();
  const send = useSendBottlePhoto();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BottlePhotoResult | null>(null);

  useEffect(() => {
    if (!picked) return;
    return () => URL.revokeObjectURL(picked.url);
  }, [picked]);

  const close = () => {
    setOpen(false);
    setPicked(null);
    setConsent(false);
    setError(null);
    setDone(null);
  };

  async function submit() {
    if (!picked || !consent || send.isPending) return;
    setError(null);
    try {
      setDone(await send.mutateAsync({ vintageId, file: picked.file }));
      setPicked(null);
    } catch (e) {
      // the photo and the yes stay, so sending can simply be tried again
      setError(
        e instanceof UnreadablePhotoError
          ? t("unreadable")
          : errorMessage(e, (k) => te(k), ERROR_MESSAGES),
      );
    }
  }

  return (
    <div>
      <p className="text-body text-ink">{t("title")}</p>
      <p className="text-small text-ink-2">{t("teaser")}</p>
      <Button className="mt-2" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>

      <Sheet open={open} onClose={close} title={t("sheetTitle")}>
        {done ? (
          <div
            className="flex flex-col items-center gap-3 text-center"
            data-testid="bottle-photo-done"
          >
            <span
              aria-hidden="true"
              className="grid size-14 place-items-center rounded-full bg-accent text-accent-ink font-display text-headline"
            >
              ✓
            </span>
            <p className="font-display text-headline text-ink">{t("thanks")}</p>
            <p className="text-body text-ink-2 text-pretty">
              {done.points > 0 ? t("earned", { points: done.points }) : t("alreadyEarned")}
            </p>
            {done.total !== null && (
              <p className="text-small text-ink-3" data-testid="points-total">
                {t("total", { points: done.total })}
              </p>
            )}
            <Button block onClick={close}>
              {t("close")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-body text-ink-2 text-pretty">{t("body", { wine })}</p>
            <ul className="list-disc pl-5 text-small text-ink-2">
              <li>{t("tipWhole")}</li>
              <li>{t("tipLight")}</li>
              <li>{t("tipBackground")}</li>
            </ul>
            {picked && (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview, not sent yet
              <img
                src={picked.url}
                alt={t("previewAlt")}
                className="mx-auto max-h-64 w-auto rounded-[16px] bg-raised object-contain"
              />
            )}
            <FileButton
              variant={picked ? "ghost" : "secondary"}
              block
              accept="image/*"
              onFile={(file) => {
                setError(null);
                setPicked({ file, url: URL.createObjectURL(file) });
              }}
            >
              {picked ? t("another") : t("choose")}
            </FileButton>
            <label className="flex items-start gap-3 rounded-[14px] bg-raised p-3 text-small text-ink">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
              />
              <span>{t("consent")}</span>
            </label>
            <p className="text-caption text-ink-3">{t("privacy")}</p>
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <Button
              block
              disabled={!picked || !consent}
              loading={send.isPending}
              onClick={() => void submit()}
            >
              {t("send")}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
