"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where the live camera is:
 *  - "idle": not asked for yet. The camera is only asked for when the person wants it (a tap), or by itself
 *    when they allowed it before (this browser says "granted", or they used it earlier in this visit);
 *  - "starting": asked for, not showing yet;
 *  - "live": the picture is on screen and a photo can be taken;
 *  - "denied": the person (or a setting) said no;
 *  - "unavailable": this device or browser has no camera to offer (or not over this connection);
 *  - "error": it should work but did not (the camera is busy, it stopped, …).
 * In every state but "live", the shutter uses the phone's own camera (a file input) instead.
 */
export type CameraState = "idle" | "starting" | "live" | "denied" | "unavailable" | "error";

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    // A label needs detail: ask for a large frame; the phone gives what it can.
    width: { ideal: 2560 },
    height: { ideal: 1920 },
  },
};

/**
 * How long the camera stays paused (picture off, not released) while the person reviews a photo, so the next
 * photo does not ask for the camera all over again. After that, or when they leave the scan screen or the app
 * goes to the background, it is released.
 */
export const KEEP_PAUSED_MS = 90_000;

/** Remembered for this visit only (the tab or app session): the person chose the live camera. */
const WANTED_KEY = "cellr.camera.wanted";

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
 * Whether the live camera starts without a tap: only when the browser already allows it, or the person chose
 * it earlier in this visit. Never when it is blocked (that would only show the same refusal again).
 */
export function startsByItself(permission: PermissionState | null, chosenThisVisit: boolean) {
  if (permission === "denied") return false;
  return permission === "granted" || chosenThisVisit;
}

const readWanted = () => {
  try {
    return sessionStorage.getItem(WANTED_KEY) === "1";
  } catch {
    return false;
  }
};
const forgetWanted = () => {
  try {
    sessionStorage.removeItem(WANTED_KEY);
  } catch {
    // nothing remembered
  }
};
const writeWanted = () => {
  try {
    sessionStorage.setItem(WANTED_KEY, "1");
  } catch {
    // private mode: the camera is then asked for with a tap each visit
  }
};

/**
 * The live camera for the scan screen, owned by the screen (not by the viewfinder), so moving between taking a
 * photo, reading it and adding the bottles does not ask for the camera again each time:
 * - `active` (the viewfinder is showing): the picture is on;
 * - not active: the picture is paused (tracks disabled) and released after KEEP_PAUSED_MS;
 * - the app in the background, or the screen left: released at once, so the camera light never stays on.
 * Only one request for the camera is ever in flight. What the browser does with the permission between visits
 * (iOS may ask again after the app was closed) is up to the browser.
 */
export function useCamera(active: boolean) {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const requesting = useRef(false);
  const alive = useRef(true);
  const activeNow = useRef(active);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [wanted, setWanted] = useState(false);
  const [visible, setVisible] = useState(true);

  const clearTimer = () => {
    if (releaseTimer.current) clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  };

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  /** The viewfinder's <video>: given the running picture whenever it (re)appears. */
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => {});
    }
  }, []);

  const open = useCallback(async () => {
    if (stream.current || requesting.current) return;
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    requesting.current = true;
    try {
      // Asked for right away (still inside the person's tap); what the screen says follows a moment later.
      const asked =
        media?.getUserMedia && window.isSecureContext ? media.getUserMedia(CONSTRAINTS) : null;
      await Promise.resolve();
      if (!asked) {
        if (alive.current) setState("unavailable");
        return;
      }
      if (alive.current) setState("starting");
      const s = await asked;
      if (!alive.current || document.visibilityState === "hidden") {
        s.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = s;
      writeWanted();
      // The camera can stop on its own (another app takes it, the phone locks): say so.
      s.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (stream.current !== s) return;
        stream.current = null;
        if (alive.current) setState("error");
      });
      s.getVideoTracks().forEach((track) => (track.enabled = activeNow.current));
      attach(video.current);
      setState("live");
    } catch (e) {
      // Refused (or failed): never asked again by itself, on return to the viewfinder, from the background or on
      // a later visit. Only a new tap ("Try the camera again") asks again.
      forgetWanted();
      if (alive.current) {
        setWanted(false);
        setState(cameraStateFor(e));
      }
    } finally {
      requesting.current = false;
    }
  }, [attach]);

  // Whether to start by itself: allowed before, or chosen earlier in this visit; a blocked camera is said so.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia || !window.isSecureContext) {
      queueMicrotask(() => !cancelled && setState("unavailable"));
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const permission = await navigator.permissions
        ?.query({ name: "camera" as PermissionName })
        .catch(() => null);
      if (cancelled) return;
      if (permission?.state === "denied") setState("denied");
      else if (startsByItself(permission?.state ?? null, readWanted())) setWanted(true);
    })();
    const onVisibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
      release();
    };
  }, [release]);

  useEffect(() => {
    activeNow.current = active;
    if (!visible) {
      // In the background: let go of the camera now; it is asked for again on return, if still wanted.
      clearTimer();
      release();
      return;
    }
    const tracks = stream.current?.getVideoTracks() ?? [];
    if (active) {
      clearTimer();
      tracks.forEach((track) => (track.enabled = true));
      if (stream.current) attach(video.current);
      // Asked for from the effect only when it starts by itself (allowed before); a tap asks directly.
      else if (wanted) queueMicrotask(() => void open());
      return;
    }
    // Reviewing a photo: picture paused, released if nobody comes back to the viewfinder for a while.
    tracks.forEach((track) => (track.enabled = false));
    if (stream.current && !releaseTimer.current)
      releaseTimer.current = setTimeout(() => {
        releaseTimer.current = null;
        release();
      }, KEEP_PAUSED_MS);
  }, [active, visible, wanted, attach, open, release]);

  /** The person wants the live camera (a tap): asked for now, inside their tap. */
  const start = useCallback(() => {
    setWanted(true);
    void open();
  }, [open]);

  /** The current frame as a JPEG file, ready for the same path a picked photo takes. */
  const capture = useCallback(async (): Promise<File | null> => {
    const el = video.current;
    if (!el || !stream.current || el.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext("2d")?.drawImage(el, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    return blob ? new File([blob], `label-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
  }, []);

  // Back from the background, the camera is being asked for again.
  const shown: CameraState = !visible && wanted ? "starting" : state;
  return { attach, state: shown, capture, start, retry: start };
}

export type Camera = ReturnType<typeof useCamera>;
