"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ERROR_MESSAGES } from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { prepareAvatar, UnreadablePhotoError, type SquareCrop } from "@/lib/photo";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { FileButton } from "@/ui/file-button";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useRemoveAvatar, useSetAvatar } from "./hooks";

const SIZES = { sm: "size-9 text-title", md: "size-11 text-headline", lg: "size-20 text-display" };

/**
 * A person as a round picture: their profile photo when there is one (served privately, only to themselves and the
 * people they share a household with), otherwise a monogram. Decorative: the name is always written beside it.
 */
export function PersonAvatar({
  name,
  src,
  size = "lg",
  className,
}: {
  name: string;
  src?: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = src && broken !== src;
  return (
    <span
      aria-hidden="true"
      data-testid="person-avatar"
      data-photo={showPhoto ? "true" : undefined}
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent font-display text-accent-ink",
        SIZES[size],
        className,
      )}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, same-origin photo: the optimiser cannot fetch it
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          draggable={false}
          onError={() => setBroken(src)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

/** The circle in the positioning step, in px. */
const FRAME = 240;
const MAX_ZOOM = 3;

interface Picked {
  file: File;
  url: string;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * My profile photo: tap it to take or choose a picture (the phone offers the camera or the library), place it in
 * the circle (drag to move, the slider to zoom), and keep it; or go back to my initials. Only the chosen square is
 * sent, small, and it shows the moment it is saved.
 */
export function AvatarEditor({ name, src }: { name: string; src: string | null }) {
  const t = useTranslations("avatar");
  const te = useTranslations();
  const toast = useToast();
  const setAvatar = useSetAvatar();
  const removeAvatar = useRemoveAvatar();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // The picked photo's preview lives as long as it is shown.
  useEffect(() => {
    if (!picked) return;
    return () => URL.revokeObjectURL(picked.url);
  }, [picked]);

  const base = picked ? FRAME / Math.min(picked.width, picked.height) : 1;
  const scale = base * zoom;
  const shown = picked ? { w: picked.width * scale, h: picked.height * scale } : { w: 0, h: 0 };
  const within = (x: number, y: number, w = shown.w, h = shown.h) => ({
    x: clamp(x, FRAME - w, 0),
    y: clamp(y, FRAME - h, 0),
  });

  const close = () => {
    setOpen(false);
    setPicked(null);
    setError(null);
  };

  async function choose(file: File) {
    setError(null);
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const p = { file, url, width: img.naturalWidth, height: img.naturalHeight };
      const s = FRAME / Math.min(p.width, p.height);
      setZoom(1);
      setOffset({ x: (FRAME - p.width * s) / 2, y: (FRAME - p.height * s) / 2 });
      setPicked(p);
    } catch {
      URL.revokeObjectURL(url);
      setError(t("unreadable"));
    }
  }

  function zoomTo(next: number) {
    if (!picked) return;
    // keep the middle of the circle where it is
    const ratio = next / zoom;
    const c = FRAME / 2;
    const w = picked.width * base * next;
    const h = picked.height * base * next;
    setOffset(within(c - (c - offset.x) * ratio, c - (c - offset.y) * ratio, w, h));
    setZoom(next);
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setOffset(within(d.ox + e.clientX - d.x, d.oy + e.clientY - d.y));
  };
  const onUp = () => {
    drag.current = null;
  };

  async function save() {
    if (!picked) return;
    setError(null);
    const crop: SquareCrop = { x: -offset.x / scale, y: -offset.y / scale, size: FRAME / scale };
    try {
      const photo = await prepareAvatar(picked.file, crop);
      await setAvatar.mutateAsync(photo);
      close();
      toast.show(t("saved"));
    } catch (e) {
      // the photo and its placing stay, so "Use photo" can simply be tapped again
      setError(
        e instanceof UnreadablePhotoError
          ? t("unreadable")
          : errorMessage(e, (k) => te(k), ERROR_MESSAGES),
      );
    }
  }

  async function remove() {
    setError(null);
    try {
      await removeAvatar.mutateAsync();
      close();
      toast.show(t("removed"));
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={src ? t("change") : t("add")}
        className="group relative shrink-0 rounded-full transition-transform duration-150 ease-cellr active:scale-95"
      >
        <PersonAvatar name={name} src={src} size="lg" />
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full bg-surface text-ink shadow-raised ring-1 ring-hairline group-hover:text-accent-fg"
        >
          <CameraGlyph />
        </span>
      </button>

      <Sheet open={open} onClose={close} title={t("title")}>
        {picked ? (
          <div className="flex flex-col items-center gap-5" data-testid="avatar-crop">
            <div
              role="img"
              aria-label={t("placeHint")}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="relative cursor-grab touch-none overflow-hidden rounded-full bg-raised shadow-raised ring-1 ring-hairline active:cursor-grabbing"
              style={{ width: FRAME, height: FRAME }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not uploaded yet */}
              <img
                src={picked.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{ left: offset.x, top: offset.y, width: shown.w, height: shown.h }}
              />
            </div>
            <p className="text-small text-ink-2">{t("placeHint")}</p>
            <label className="flex w-full max-w-xs items-center gap-3 text-small text-ink-2">
              <span>{t("zoom")}</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => zoomTo(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
            </label>
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setPicked(null)}>
                {t("back")}
              </Button>
              <Button loading={setAvatar.isPending} onClick={() => void save()}>
                {t("use")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            <PersonAvatar name={name} src={src} size="lg" className="size-28 text-hero" />
            <p className="text-center text-small text-ink-2">{t("body")}</p>
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex w-full flex-col gap-2">
              <FileButton variant="primary" block onFile={(f) => void choose(f)}>
                {src ? t("replace") : t("choose")}
              </FileButton>
              {src && (
                <Button
                  variant="ghost"
                  block
                  loading={removeAvatar.isPending}
                  onClick={() => void remove()}
                >
                  {t("remove")}
                </Button>
              )}
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

function CameraGlyph() {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 8h3l1.6-2.2A2 2 0 0 1 10.2 5h3.6a2 2 0 0 1 1.6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
