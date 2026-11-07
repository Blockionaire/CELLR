"use client";

import { useMutation } from "@tanstack/react-query";
import type { PurchaseCheckRequest, PurchaseCheckResult, PurchaseRecognition } from "@cellr/domain";
import { api } from "@/lib/api";
import { preparePhoto } from "@/lib/photo";
import { readLabelText } from "@/features/scan/ocr";

/**
 * Koopcheck, step 1: the photo is shrunk on the phone (the camera's location dropped), its printed text read on the
 * phone when it can be, and sent to be read. Nothing is kept on the server.
 */
export function useRecognizeBottle() {
  return useMutation({
    mutationFn: async (file: Blob) => {
      const prepared = await preparePhoto(file);
      const form = new FormData();
      form.set("photo", prepared.photo, "label.jpg");
      // The printed text may name a wine CELLR knows, so no model (and no cost) is needed. Not ready: just the photo.
      const reading = await readLabelText(prepared.photo).catch(() => null);
      if (reading?.text) form.set("labelText", reading.text);
      return api.upload<PurchaseRecognition>("/sommelier/purchase-check/recognize", form);
    },
  });
}

/** Koopcheck, step 2: the confirmed wine against the cellar and your taste. No AI, so it can be repeated freely. */
export function useComparePurchase() {
  return useMutation({
    mutationFn: (input: PurchaseCheckRequest) =>
      api.post<PurchaseCheckResult>("/sommelier/purchase-check/compare", input),
  });
}
