"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { formatVintage, type PlacedBottle } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { Skeleton } from "@/ui/skeleton";
import { useRacks } from "./hooks";
import { BottlePeekSheet } from "./rack-sheets";
import { shapeFor } from "./wine-visuals";
import { useBottleActions } from "./use-bottle-actions";

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

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Your cellar in 3D: one storage unit at a time, bottles lying in their spots. Drag to turn it, pinch to
 * zoom, tap a bottle. Everything else (opening, details) is the same sheet as in the racks view, and a
 * keyboard / screen-reader list of the same bottles sits alongside, since a canvas cannot be read aloud.
 */
export function Cellar3DView({ onShowRacks }: { onShowRacks: () => void }) {
  const t = useTranslations("cellar3d");
  const tKinds = useTranslations("storageKinds");
  const tr = useTranslations("racks");
  const tRack = useTranslations("rack");
  const racks = useRacks();
  const actions = useBottleActions();
  const webgl = useWebGL();
  const reduced = useReducedMotion();
  const [unitId, setUnitId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [touched, setTouched] = useState(false);

  const data = racks.data;
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
  if (data.units.length === 0)
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

  const unit = data.units.find((u) => u.id === unitId) ?? data.units[0]!;
  const selected: PlacedBottle | null = unit.bottles.find((b) => b.bottleId === selectedId) ?? null;
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
                setSelectedId(null);
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

      <div
        role="group"
        aria-label={t("canvasLabel", { unit: unit.label })}
        className="relative h-[min(68vh,34rem)] min-h-80 touch-none overflow-hidden rounded-card border border-hairline bg-raised"
        style={{
          backgroundImage:
            "radial-gradient(120% 90% at 50% 30%, color-mix(in srgb, var(--ink) 9%, transparent), transparent 70%)",
        }}
        data-testid="cellar-3d"
        data-ready={ready}
        onPointerDown={() => setTouched(true)}
      >
        <div
          className="h-full w-full cursor-grab transition-opacity duration-500 active:cursor-grabbing"
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
            selectedId={selected?.bottleId ?? null}
            onPick={(id) => {
              setError(null);
              setSelectedId(id);
            }}
            reducedMotion={reduced}
            onReady={() => setReady(true)}
          />
        </div>
        <p
          className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-caption text-ink-2 transition-opacity duration-500"
          style={{ opacity: touched ? 0 : 1 }}
        >
          {t("hint")}
        </p>
      </div>

      {/* The same bottles for keyboard and screen-reader users. */}
      <ul
        className="sr-only focus-within:not-sr-only focus-within:flex focus-within:flex-col focus-within:gap-1 focus-within:rounded-card focus-within:bg-raised focus-within:p-3"
        aria-label={t("listLabel", { unit: unit.label })}
      >
        {unit.bottles.map((b) => (
          <li key={b.bottleId}>
            <button type="button" onClick={() => setSelectedId(b.bottleId)}>
              {tRack("cellBottle", { wine: name(b), row: b.row ?? 0, col: b.col ?? 0 })}
            </button>
          </li>
        ))}
      </ul>

      <BottlePeekSheet
        bottle={selected}
        unitLabel={unit.label}
        busy={actions.pending}
        error={error}
        onClose={() => setSelectedId(null)}
        onOpen={async () => {
          if (!selected) return;
          const failure = await actions.open(selected.bottleId, remaining(selected));
          if (failure) setError(failure);
          else setSelectedId(null);
        }}
      />
    </div>
  );
}
