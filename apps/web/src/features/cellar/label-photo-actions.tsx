"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ImageRef, ImageSide } from "@cellr/domain";
import { preparePhoto, UnreadablePhotoError, type PreparedPhoto } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { useToast } from "@/ui/toast";
import { useLabelPhoto, useReframeLabel, useRemoveLabelPhoto } from "./hooks";
import { LabelFramer } from "./label-framer";

/**
 * Under the picture of a wine: add the front or back label photo, change it, take it off, and (for the front)
 * show where the label is so the 3D bottle wears just that. A new front photo goes straight to the framing step.
 */
export function LabelPhotoActions({
  vintageId,
  side = "front",
  image,
}: {
  vintageId: string;
  side?: ImageSide;
  image: ImageRef | null;
}) {
  const t = useTranslations("photo");
  const toast = useToast();
  const upload = useLabelPhoto(vintageId, side);
  const remove = useRemoveLabelPhoto(vintageId, side);
  const reframe = useReframeLabel();
  const [fresh, setFresh] = useState<PreparedPhoto | null>(null);
  const [existing, setExisting] = useState<Blob | null>(null);
  const busy = upload.isPending || remove.isPending || reframe.isPending;
  const hasPhoto = image !== null;

  async function choose(file: File) {
    try {
      const prepared = await preparePhoto(file);
      if (side === "front") setFresh(prepared);
      else upload.mutate({ prepared });
    } catch (e) {
      toast.show(e instanceof UnreadablePhotoError ? t("unreadable") : t("frameFailed"), {
        tone: "error",
      });
    }
  }

  async function adjust() {
    if (!image) return;
    try {
      const response = await fetch(`/api/v1/images/${image.id}?size=photo`, {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("photo");
      setExisting(await response.blob());
    } catch {
      toast.show(t("frameFailed"), { tone: "error" });
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-busy={busy}>
      <FileButton size="sm" variant="secondary" disabled={busy} onFile={choose}>
        {upload.isPending
          ? t("saving")
          : side === "back"
            ? hasPhoto
              ? t("changeBack")
              : t("addBack")
            : hasPhoto
              ? t("change")
              : t("add")}
      </FileButton>
      {side === "front" && hasPhoto && !busy && (
        <Button variant="ghost" size="sm" onClick={adjust}>
          {t("adjustFrame")}
        </Button>
      )}
      {hasPhoto && !upload.isPending && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove.mutate()}>
          {side === "back" ? t("removeBack") : t("remove")}
        </Button>
      )}

      {fresh && (
        <LabelFramer
          open
          onClose={() => setFresh(null)}
          photo={fresh.photo}
          initial={null}
          busy={upload.isPending}
          onConfirm={(quad) =>
            upload.mutate({ prepared: fresh, quad }, { onSettled: () => setFresh(null) })
          }
          onSkip={() => upload.mutate({ prepared: fresh }, { onSettled: () => setFresh(null) })}
        />
      )}
      {existing && image && (
        <LabelFramer
          open
          onClose={() => setExisting(null)}
          photo={existing}
          initial={null}
          busy={reframe.isPending}
          onConfirm={(quad) =>
            reframe.mutate(
              { imageId: image.id, photo: existing, quad },
              { onSettled: () => setExisting(null) },
            )
          }
          onSkip={() =>
            reframe.mutate(
              { imageId: image.id, photo: existing, quad: null },
              { onSettled: () => setExisting(null) },
            )
          }
        />
      )}
    </div>
  );
}
