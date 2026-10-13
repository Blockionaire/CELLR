"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatVintage, type PlacedBottle } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { Skeleton } from "@/ui/skeleton";
import { BottleShowcasePanel } from "./bottle-showcase-panel";
import { imageUrl } from "./label-image";
import { useRacks, useVintageDetail } from "./hooks";
import { MoveBottleSheet } from "./move-bottle-sheet";
import { NewPlaceSheet } from "./new-place-sheet";
import { SIDE_BY_SIDE_MIN_WIDTH, type ShowcaseLayout } from "./three/layout";
import type { Backdrop } from "./three/scene";
import type { ShownBottle } from "./three/types";
import { useBottleActions } from "./use-bottle-actions";
import { placeLine, shapeFor } from "./wine-visuals";

/** three.js is large: it is only downloaded when someone actually opens the 3D view. */
const Scene = dynamic(() => import("./three/scene"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

// ---- Capabilities: asked once, answered the same everywhere ----------------------------------------------------

let webglSupport: boolean | undefined;
function detectWebGL(): boolean {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noSubscription = () => () => {};
const useWebGL = () => useSyncExternalStore(noSubscription, detectWebGL, () => true);

function useMedia(query: string, server: boolean): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => server,
  );
}
const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)", false);
/** Wide screens show the bottle beside its details; narrow ones (a phone) show it above them. */
const useShowcaseLayout = (): ShowcaseLayout =>
  useMedia(`(min-width: ${SIDE_BY_SIDE_MIN_WIDTH}px)`, true) ? "side" : "top";

type SheetName = "move" | "place" | null;

/**
 * Your cellar in 3D: one storage unit at a time, bottles lying in their spots. Drag to turn it, pinch to
 * zoom, tap a bottle: it slides out of the rack, stands up with its label towards you, and its details
 * open beside it. A keyboard / screen-reader list of the same bottles sits alongside, since a canvas
 * cannot be read aloud.
 */
export function Cellar3DView({ onShowRacks }: { onShowRacks: () => void }) {
  const t = useTranslations("cellar3d");
  const tKinds = useTranslations("storageKinds");
  const tr = useTranslations("racks");
  const tRack = useTranslations("rack");
  const locale = useLocale();
  const racks = useRacks();
  const actions = useBottleActions();
  const webgl = useWebGL();
  const reduced = useReducedMotion();
  const layout = useShowcaseLayout();
  const stage = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [exit, setExit] = useState<"home" | "gone">("home");
  const [veil, setVeil] = useState("#f0ebe0");
  const [sheet, setSheet] = useState<SheetName>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);
  // A still of the rack stands behind the bottle on display (see Freezer in the scene).
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  useEffect(() => {
    if (!backdrop) return;
    return () => URL.revokeObjectURL(backdrop.url);
  }, [backdrop]);
  // The panel keeps showing the last bottle while it slides out.
  const [lastBottle, setLastBottle] = useState<PlacedBottle | null>(null);

  const backdropRef = useRef<Backdrop | null>(null);
  const openRef = useRef(false);
  useEffect(() => {
    backdropRef.current = backdrop;
  }, [backdrop]);

  const data = racks.data;
  const unit = data?.units.find((u) => u.id === unitId) ?? data?.units[0] ?? null;
  const picked: PlacedBottle | null = unit?.bottles.find((b) => b.bottleId === pickedId) ?? null;
  if (picked && picked !== lastBottle) setLastBottle(picked);
  const detail = useVintageDetail(picked?.vintageId ?? lastBottle?.vintageId ?? null).data;

  const pick = useCallback((id: string) => {
    // The bottle that is on its way home is not done yet: wait for the rack to be live again.
    if (backdropRef.current && !openRef.current) return;
    // Remember where focus was and what colour the card is, then take the bottle out.
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (stage.current) setVeil(getComputedStyle(stage.current).backgroundColor);
    setError(null);
    setExit("home");
    setPickedId(id);
  }, []);
  const putBack = useCallback(() => {
    setExit("home");
    setPickedId(null);
    setError(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    // Give the panel a moment to go inert before focus returns to what opened it.
    if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }, []);

  // Escape puts the bottle back (unless a sheet is open: that handles Escape itself).
  useEffect(() => {
    if (pickedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sheet === null) putBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickedId, sheet, putBack]);

  const showcase: ShownBottle | null = useMemo(
    () =>
      picked && picked.row !== null && picked.col !== null
        ? {
            bottle: {
              id: picked.bottleId,
              row: picked.row,
              col: picked.col,
              type: picked.type,
              shape: shapeFor(picked.type),
            },
            label: {
              producer: picked.producer,
              name: picked.wineName,
              year: picked.year,
              place: placeLine(picked.region, picked.countryCode, locale),
              type: picked.type,
              photoUrl: picked.image
                ? imageUrl(picked.image.id, picked.image.texture ? "texture" : "photo")
                : null,
              textured: picked.image?.texture === true,
            },
          }
        : null,
    [picked, locale],
  );

  const isOpen = showcase !== null;
  useEffect(() => {
    openRef.current = isOpen;
  }, [isOpen]);

  if (!webgl)
    return (
      <EmptyState
        title={t("noWebglTitle")}
        body={t("noWebglBody")}
        action={
          <Button size="lg" onClick={onShowRacks}>
            {t("showRacks")}
          </Button>
        }
      />
    );
  if (data === undefined) return <Skeleton className="h-[26rem]" />;
  if (data.units.length === 0 || !unit)
    return (
      <EmptyState
        title={t("emptyTitle")}
        body={t("emptyBody")}
        action={
          <Button size="lg" onClick={onShowRacks}>
            {t("showRacks")}
          </Button>
        }
      />
    );

  const open = showcase !== null;
  const fullscreen = open && layout === "top";
  const remaining = (b: PlacedBottle) =>
    [...data.units.flatMap((u) => u.bottles), ...data.unplaced].filter(
      (x) => x.vintageId === b.vintageId,
    ).length - 1;
  const name = (b: PlacedBottle) => `${b.producer} ${b.wineName} ${formatVintage(b.year)}`;

  return (
    <div className="flex flex-col gap-4">
      {data.units.length > 1 && (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0">
          {data.units.map((u) => (
            <Chip
              key={u.id}
              selected={u.id === unit.id}
              onClick={() => {
                setUnitId(u.id);
                setPickedId(null);
                setBackdrop(null);
                setReady(false);
              }}
            >
              {u.label}
            </Chip>
          ))}
        </div>
      )}
      <p className="text-small text-ink-2">
        {unit.label === tKinds(unit.kind) ? "" : `${tKinds(unit.kind)} · `}
        {tr("unitMeta", { used: unit.used, capacity: unit.capacity, free: unit.free })}
      </p>

      {/* The card keeps its place in the page while the phone version fills the screen. */}
      <div className="relative h-[min(68vh,34rem)] min-h-80">
        <div
          ref={stage}
          role="group"
          aria-label={t("canvasLabel", { unit: unit.label })}
          className={cn(
            "overflow-hidden border-hairline bg-raised",
            fullscreen ? "fixed inset-0 z-50" : "absolute inset-0 rounded-card border",
          )}
          style={{
            backgroundImage:
              "radial-gradient(120% 90% at 50% 30%, color-mix(in srgb, var(--ink) 9%, transparent), transparent 70%)",
          }}
          data-testid="cellar-3d"
          data-ready={ready}
          data-showcase={open ? "open" : "closed"}
          onPointerDown={() => setTouched(true)}
        >
          {backdrop && (
            <div
              aria-hidden="true"
              data-testid="rack-backdrop"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `url(${backdrop.url})`,
                backgroundSize: "100% 100%",
                transformOrigin: `${backdrop.originX}% ${backdrop.originY}%`,
                // Out comes the bottle: the still rack steps back (blurred, dimmed) and leans in a little; going
                // home reverses it, a touch quicker than the bottle, so the live rack takes over unnoticed.
                transform: open ? "scale(1.12)" : "scale(1)",
                filter: open ? "blur(7px) brightness(0.55) saturate(0.45)" : "none",
                transition: reduced
                  ? "none"
                  : open
                    ? "transform 1.3s cubic-bezier(0.2, 0.7, 0.2, 1), filter 0.9s ease"
                    : "transform 0.6s ease, filter 0.5s ease",
              }}
            />
          )}
          <div
            className="h-full w-full cursor-grab touch-none transition-opacity duration-500 active:cursor-grabbing"
            style={{ opacity: ready ? 1 : 0 }}
            aria-hidden="true"
          >
            <Scene
              key={unit.id}
              rows={unit.rows}
              cols={unit.cols}
              kind={unit.kind}
              bottles={unit.bottles.flatMap((b) =>
                b.row === null || b.col === null
                  ? []
                  : [
                      {
                        id: b.bottleId,
                        row: b.row,
                        col: b.col,
                        type: b.type,
                        shape: shapeFor(b.type),
                      },
                    ],
              )}
              showcase={showcase}
              exit={exit}
              layout={layout}
              veil={veil}
              onPick={pick}
              onDismiss={putBack}
              reducedMotion={reduced}
              onReady={() => setReady(true)}
              onBackdrop={setBackdrop}
            />
          </div>
          <p
            className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-caption text-ink-2 transition-opacity duration-500"
            style={{ opacity: touched || open ? 0 : 1 }}
          >
            {t("hint")}
          </p>

          {lastBottle && (
            <BottleShowcasePanel
              bottle={picked ?? lastBottle}
              unitLabel={unit.label}
              detail={detail}
              open={open}
              layout={layout}
              busy={actions.pending}
              error={error}
              onClose={putBack}
              onOpen={async () => {
                if (!picked) return;
                const failure = await actions.open(picked.bottleId, remaining(picked));
                if (failure) return setError(failure);
                // It has been opened: the bottle does not go back, it is gone.
                setExit("gone");
                setPickedId(null);
                returnFocus.current = null;
              }}
              onMove={() => setSheet("move")}
            />
          )}
        </div>
      </div>

      {/* The same bottles for keyboard and screen-reader users; visible while one has focus. */}
      <ul
        className="sr-only focus-within:not-sr-only focus-within:flex focus-within:flex-col focus-within:gap-1 focus-within:rounded-card focus-within:bg-raised focus-within:p-3"
        aria-label={t("listLabel", { unit: unit.label })}
      >
        {unit.bottles.map((b) => (
          <li key={b.bottleId}>
            <button type="button" onClick={() => pick(b.bottleId)}>
              {tRack("cellBottle", { wine: name(b), row: b.row ?? 0, col: b.col ?? 0 })}
            </button>
          </li>
        ))}
      </ul>

      {detail && (
        <>
          <MoveBottleSheet
            open={sheet === "move"}
            onClose={() => setSheet(null)}
            detail={detail}
            bottleId={picked?.bottleId ?? lastBottle?.bottleId}
            onNewPlace={() => setSheet("place")}
          />
          <NewPlaceSheet
            open={sheet === "place"}
            onClose={() => setSheet("move")}
            onCreated={() => undefined}
          />
        </>
      )}
    </div>
  );
}
