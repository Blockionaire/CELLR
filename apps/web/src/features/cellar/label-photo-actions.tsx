"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { useLabelPhoto, useRemoveLabelPhoto } from "./hooks";

/** Under the picture of a wine: add the label photo, change it, or take it off again. */
export function LabelPhotoActions({
  vintageId,
  hasPhoto,
}: {
  vintageId: string;
  hasPhoto: boolean;
}) {
  const t = useTranslations("photo");
  const upload = useLabelPhoto(vintageId);
  const remove = useRemoveLabelPhoto(vintageId);
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-busy={busy}>
      <FileButton
        size="sm"
        variant="secondary"
        disabled={busy}
        onFile={(file) => upload.mutate(file)}
      >
        {upload.isPending ? t("saving") : hasPhoto ? t("change") : t("add")}
      </FileButton>
      {hasPhoto && !upload.isPending && (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => remove.mutate()}>
          {t("remove")}
        </Button>
      )}
    </div>
  );
}
