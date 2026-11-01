"use client";

import { useMutation } from "@tanstack/react-query";
import type { ScanResult } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { sendTexture } from "@/features/cellar/hooks";
import { photoForm, preparePhoto } from "@/lib/photo";
import { readLabelText } from "./ocr";

/**
 * Sends a label photo to be kept and read. The phone shrinks it first (and drops the location the camera
 * wrote into it); the answer says what wine it is, or that it could not be read: the photo is kept either way.
 */
export function useScan() {
  return useMutation({
    mutationFn: async (file: Blob) => {
      const prepared = await preparePhoto(file);
      const form = photoForm(prepared);
      // The label's printed text, read on the phone within a short budget, from the already shrunk photo: the server
      // may then recognise a known catalogue wine without the vision model. Not tried, not ready or nothing read:
      // the photo is sent as before.
      const reading = await readLabelText(prepared.photo).catch(() => null);
      if (reading) {
        form.set("labelText", reading.text ?? "");
        form.set("labelTextMs", String(reading.ms));
      }
      const result = await api.upload<ScanResult>("/scans", form);
      // Where the AI found the label: straighten it in the background, so the 3D bottle wears just the label.
      // Nobody waits for this, and if it fails the whole photo is simply used instead.
      if (result.labelCorners)
        void sendTexture(result.image.id, prepared.photo, result.labelCorners);
      return result;
    },
    onMutate: () => track("wine_scan_started"),
    onSuccess: (result) =>
      track(result.outcome === "unread" ? "wine_scan_failed" : "wine_scan_completed", {
        outcome: result.outcome,
        // which path answered (no wine, text or photo in it): the photo cache, the label text, or the model
        path: result.remembered ? "photo_cache" : result.fromText ? "label_text" : "vision",
      }),
    onError: () => track("wine_scan_failed", { outcome: "error" }),
  });
}
