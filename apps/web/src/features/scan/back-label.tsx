"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { preparePhoto, UnreadablePhotoError, type PreparedPhoto } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { useToast } from "@/ui/toast";
import { attachBackLabel, type BackLabelOutcome } from "@/features/cellar/hooks";

/** A local preview of a photo not yet sent anywhere; made and revoked with the component that shows it. */
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const made = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an object URL must be made and revoked with the component
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [blob]);
  return url;
}

const THUMB = "h-28 w-20 shrink-0 overflow-hidden rounded-[12px] bg-raised ring-1 ring-hairline";

/**
 * Front and back, side by side, while confirming a scanned wine: the front is the photo just read; the back is
 * optional, kept on this device until the bottles are added (so leaving the scan uploads nothing), and can be
 * retaken or removed. No AI reads it.
 */
export function BackLabelPicker({
  frontImageId,
  value,
  onChange,
}: {
  frontImageId: string;
  value: PreparedPhoto | null;
  onChange: (next: PreparedPhoto | null) => void;
}) {
  const t = useTranslations("photo");
  const toast = useToast();
  const preview = useObjectUrl(value?.photo ?? null);
  const choose = async (file: File) => {
    try {
      onChange(await preparePhoto(file));
    } catch (e) {
      toast.show(e instanceof UnreadablePhotoError ? t("unreadable") : t("frameFailed"), {
        tone: "error",
      });
    }
  };
  return (
    <section
      aria-label={t("labelsTitle")}
      data-testid="scan-labels"
      className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-raised ring-1 ring-hairline"
    >
      <figure className="flex flex-col items-center gap-1">
        <div className={THUMB}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the household's own photo, served privately */}
          <img
            src={`/api/v1/images/${frontImageId}?size=thumb`}
            alt={t("frontTitle")}
            className="size-full object-cover"
          />
        </div>
        <figcaption className="text-caption text-ink-2">{t("frontTitle")}</figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-1">
        <div className={THUMB}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview, not uploaded yet
            <img src={preview} alt={t("backTitle")} className="size-full object-cover" />
          ) : (
            <span aria-hidden="true" className="grid size-full place-items-center text-ink-3">
              +
            </span>
          )}
        </div>
        <figcaption className="text-caption text-ink-2">{t("backTitle")}</figcaption>
      </figure>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="text-small text-ink-2">{value ? t("backReady") : t("backOptional")}</p>
        <div className="flex flex-wrap gap-2">
          <FileButton size="sm" variant="secondary" onFile={choose}>
            {value ? t("retakeBack") : t("addBack")}
          </FileButton>
          {value && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t("removeBack")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * After the bottles are in: what became of the back label. Saved says so; a wine that already had one asks
 * before replacing it; a failure offers to try again (the bottles are added either way).
 */
export function BackLabelResult({
  vintageId,
  photo,
  initial,
}: {
  vintageId: string;
  photo: PreparedPhoto;
  initial: BackLabelOutcome | "saving";
}) {
  const t = useTranslations("photo");
  const queryClient = useQueryClient();
  const [state, setState] = useState<BackLabelOutcome | "saving" | "kept">(initial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the outcome arrives after the screen is shown
    setState(initial);
  }, [initial]);
  const attach = async (replace: boolean) => {
    setState("saving");
    const outcome = await attachBackLabel(vintageId, photo, replace);
    setState(outcome);
    if (outcome === "saved") await queryClient.invalidateQueries({ queryKey: ["vintage"] });
  };
  return (
    <div
      role="status"
      data-testid="back-label-result"
      data-state={state}
      className="w-full rounded-card bg-surface p-4 text-left shadow-raised ring-1 ring-hairline"
    >
      {state === "saving" && <p className="text-body text-ink-2">{t("backSaving")}</p>}
      {state === "saved" && <p className="text-body text-ink">{t("backSaved")}</p>}
      {state === "kept" && <p className="text-body text-ink-2">{t("backKept")}</p>}
      {state === "exists" && (
        <>
          <p className="text-body text-ink">{t("backExists")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void attach(true)}>
              {t("backReplace")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setState("kept")}>
              {t("backKeep")}
            </Button>
          </div>
        </>
      )}
      {state === "failed" && (
        <>
          <p className="text-body text-danger">{t("backFailed")}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void attach(false)}>
            {t("backRetry")}
          </Button>
        </>
      )}
    </div>
  );
}
