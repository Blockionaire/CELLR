"use client";

import { useMutation } from "@tanstack/react-query";
import type { ScanResult } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { sendTexture } from "@/features/cellar/hooks";
import { photoForm, preparePhoto } from "@/lib/photo";

/**
 * Sends a label photo to be kept and read. The phone shrinks it first (and drops the location the camera
 * wrote into it); the answer says what wine it is, or that it could not be read: the photo is kept either way.
 */
export function useScan() {
  return useMutation({
    mutationFn: async (file: Blob) => {
      const prepared = await preparePhoto(file);
      const result = await api.upload<ScanResult>("/scans", photoForm(prepared));
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
      }),
    onError: () => track("wine_scan_failed", { outcome: "error" }),
  });
}
