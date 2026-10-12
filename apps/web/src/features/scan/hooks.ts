"use client";

import { useMutation } from "@tanstack/react-query";
import type { ScanResult } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { photoForm, preparePhoto } from "@/lib/photo";

/**
 * Sends a label photo to be kept and read. The phone shrinks it first (and drops the location the camera
 * wrote into it); the answer says what wine it is, or that it could not be read: the photo is kept either way.
 */
export function useScan() {
  return useMutation({
    mutationFn: async (file: Blob) =>
      api.upload<ScanResult>("/scans", photoForm(await preparePhoto(file))),
    onMutate: () => track("wine_scan_started"),
    onSuccess: (result) =>
      track(result.outcome === "unread" ? "wine_scan_failed" : "wine_scan_completed", {
        outcome: result.outcome,
      }),
    onError: () => track("wine_scan_failed", { outcome: "error" }),
  });
}
