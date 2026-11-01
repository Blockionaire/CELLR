"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BOTTLE_PHOTO_MAX, ERROR_MESSAGES, type BottlePhotoResult } from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { preparePhoto, UnreadablePhotoError } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { Sheet } from "@/ui/sheet";

interface Picked {
  file: File;
  url: string;
}

/** Sends one contribution of 1 to 3 bottle photos with the explicit yes; my points refresh after. */
function useSendBottlePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vintageId, files }: { vintageId: string; files: File[] }) => {
      const prepared = await Promise.all(files.map((f) => preparePhoto(f)));
      const form = new FormData();
      prepared.forEach((p, i) => form.append("photo", p.photo, `bottle-${i + 1}.jpg`));
      form.set("vintageId", vintageId);
      form.set("consent", "true");
      return api.upload<BottlePhotoResult>("/bottle-photos", form);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["points"] }),
  });
}

/**
 * Helping CELLR picture a wine: 1 to 3 photos (the whole bottle, the labels close up), sent together with one
 * explicit yes that CELLR may use them to make and show a 2D bottle picture of this wine. The photos themselves are
 * never shown in the app. The first contribution for a wine earns points; another one is welcome and says so.
 */
export function BottlePhotoContribution({ vintageId, wine }: { vintageId: string; wine: string }) {
  const t = useTranslations("bottlePhoto");
  const te = useTranslations();
  const send = useSendBottlePhoto();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BottlePhotoResult | null>(null);

  // each preview's local address goes when its photo does (removed, sent, the sheet closed or the page left)
  const urls = useRef<Picked[]>([]);
  useEffect(() => {
    urls.current = picked;
  }, [picked]);
  useEffect(() => () => urls.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  const drop = (gone: Picked[]) => gone.forEach((p) => URL.revokeObjectURL(p.url));

  const close = () => {
    setOpen(false);
    drop(picked);
    setPicked([]);
    setConsent(false);
    setError(null);
    setDone(null);
  };

  async function submit() {
    if (picked.length === 0 || !consent || send.isPending) return;
    setError(null);
    try {
      setDone(await send.mutateAsync({ vintageId, files: picked.map((p) => p.file) }));
      drop(picked);
      setPicked([]);
    } catch (e) {
      // the photos and the yes stay, so sending can simply be tried again
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
              <li>{t("tipMore")}</li>
            </ul>
            {picked.length > 0 && (
              <ul className="grid grid-cols-3 gap-2" data-testid="bottle-photo-previews">
                {picked.map((p, i) => (
                  <li key={p.url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not sent yet */}
                    <img
                      src={p.url}
                      alt={t("previewAlt", { n: i + 1 })}
                      className="aspect-[3/4] w-full rounded-[12px] bg-raised object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t("remove")}
                      onClick={() => {
                        drop([p]);
                        setPicked((all) => all.filter((x) => x !== p));
                      }}
                      className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-canvas/90 text-small text-ink ring-1 ring-hairline"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {picked.length < BOTTLE_PHOTO_MAX && (
              <FileButton
                variant={picked.length ? "ghost" : "secondary"}
                block
                accept="image/*"
                onFile={(file) => {
                  setError(null);
                  setPicked((all) =>
                    all.length >= BOTTLE_PHOTO_MAX
                      ? all
                      : [...all, { file, url: URL.createObjectURL(file) }],
                  );
                }}
              >
                {picked.length
                  ? t("another", { count: picked.length + 1, max: BOTTLE_PHOTO_MAX })
                  : t("choose")}
              </FileButton>
            )}
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
              disabled={picked.length === 0 || !consent}
              loading={send.isPending}
              onClick={() => void submit()}
            >
              {t("send", { count: Math.max(1, picked.length) })}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
