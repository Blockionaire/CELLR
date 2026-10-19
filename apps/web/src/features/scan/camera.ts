"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where the live camera is:
 *  - "starting": asked for, not showing yet;
 *  - "live": the picture is on screen and a photo can be taken;
 *  - "denied": the person (or a setting) said no;
 *  - "unavailable": this device or browser has no camera to offer (or not over this connection);
 *  - "error": it should work but did not (the camera is busy, it stopped, …).
 * In every state but "live", the shutter falls back to the phone's own camera (a file input).
 */
export type CameraState = "starting" | "live" | "denied" | "unavailable" | "error";

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    // A label needs detail: ask for a large frame; the phone gives what it can.
    width: { ideal: 2560 },
    height: { ideal: 1920 },
  },
};

/** Maps what getUserMedia throws to what the screen says. */
export function cameraStateFor(error: unknown): CameraState {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "denied";
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  )
    return "unavailable";
  return "error";
}

/**
 * The live camera for the scan screen. It starts when `active`, stops when not (and whenever the app goes to the
 * background, so the camera light does not stay on), and starts again when the person comes back.
 */
export function useCamera(active: boolean) {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [attempt, setAttempt] = useState(0);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!active) {
      stop();
      return;
    }
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia || !window.isSecureContext) {
      // Reported from inside the effect's async start below, never synchronously.
      queueMicrotask(() => setState("unavailable"));
      return;
    }
    let cancelled = false;

    const start = async () => {
      try {
        // A camera the person has blocked before: do not ask again on every visit.
        const permission = await navigator.permissions
          ?.query({ name: "camera" as PermissionName })
          .catch(() => null);
        if (permission?.state === "denied") {
          if (!cancelled) setState("denied");
          return;
        }
        const s = await media.getUserMedia(CONSTRAINTS);
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = s;
        // The camera can stop on its own (another app takes it, the phone locks): say so.
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled) setState("error");
        });
        const el = video.current;
        if (el) {
          el.srcObject = s;
          await el.play().catch(() => {});
        }
        if (!cancelled) setState("live");
      } catch (e) {
        if (!cancelled) setState(cameraStateFor(e));
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setState("starting");
      } else if (!stream.current) void start();
    };

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [active, attempt, stop]);

  /** The current frame as a JPEG file, ready for the same path a picked photo takes. */
  const capture = useCallback(async (): Promise<File | null> => {
    const el = video.current;
    if (!el || state !== "live" || el.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    return blob ? new File([blob], `label-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
  }, [state]);

  const retry = useCallback(() => {
    setState("starting");
    setAttempt((a) => a + 1);
  }, []);

  return { video, state, capture, retry };
}
