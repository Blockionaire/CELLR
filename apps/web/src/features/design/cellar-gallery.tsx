"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  STORAGE_PALETTES,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  type StorageTemplateId,
} from "@cellr/domain";
import { fixtureBottles, type FixtureBottle } from "@/features/cellar/storage3d/fixtures";
import { LayoutMap } from "@/features/cellar/storage3d/layout-map";
import { buildModel } from "@/features/cellar/storage3d/model";
import { Button } from "@/ui/button";
import {
  LEGACY_KINDS,
  UNKNOWN_CASES,
  normalize,
  placeOf,
  toQuery,
  type GalleryState,
  type UnknownCase,
} from "./cellar-gallery-state";

/**
 * Every storage template, to look at (Smart Cellar 3D, sprint 2A): the new layout-driven 3D view and the flat
 * picture of the same place side by side, with made-up bottles. Not a product screen: English only, no account,
 * no database. A place from before templates is shown by the EXISTING 3D view, untouched, for comparison.
 */
const TemplateScene = dynamic(() => import("@/features/cellar/storage3d/template-scene"), {
  ssr: false,
  loading: () => <StageNote>Loading the 3D view…</StageNote>,
});
const LegacyScene = dynamic(() => import("@/features/cellar/three/scene"), {
  ssr: false,
  loading: () => <StageNote>Loading the 3D view…</StageNote>,
});

const TEMPLATE_NAMES: Record<StorageTemplateId, string> = {
  rack_classic: "Classic wooden rack",
  rack_double_depth: "Double-depth rack",
  rack_metal: "Metal rack",
  shelving_open: "Open shelving",
  cabinet_closed: "Closed cabinet",
  cube_modular: "Modular cubes",
  diamond_bins: "Diamond bins",
  crate_storage: "Crates",
  wall_pegs: "Wall pegs",
  wall_rails: "Wall rails",
  cooler_single: "Wine cooler, one zone",
  cooler_dual: "Wine cooler, two zones",
  cooler_undercounter: "Undercounter cooler",
  rack_generic: "Generic rack",
};

function StageNote({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-small text-ink-2">
      {children}
    </div>
  );
}

const none = () => () => {};
const useMedia = (query: string) =>
  useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
let webgl: boolean | undefined;
const hasWebGL = () => {
  if (webgl === undefined) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
};

export function CellarGallery({ initial }: { initial: GalleryState }) {
  const [state, setState] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [mount, setMount] = useState(0);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const supported = useSyncExternalStore(none, hasWebGL, () => true);

  const set = (patch: Partial<GalleryState>) => {
    setSelected(null);
    setState((s) => normalize({ ...s, ...patch }));
  };
  // the address follows what is shown, so a picture can be linked to
  useEffect(() => {
    window.history.replaceState(null, "", `?${toQuery(state)}`);
  }, [state]);

  const resolved = useMemo(() => placeOf(state), [state]);
  const model = useMemo(() => buildModel(resolved), [resolved]);
  const bottles = useMemo(
    () => fixtureBottles(resolved.layout, state.fill),
    [resolved, state.fill],
  );
  const mapBottles = useMemo(() => bottles.map((b) => ({ ...b, name: wineName(b) })), [bottles]);
  const picked = selected === null ? null : (bottles.find((b) => b.id === selected) ?? null);
  const t = STORAGE_TEMPLATES[state.template];
  const isTemplate = state.sample === "template";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6" data-testid="cellar-gallery">
      <p className="text-caption uppercase tracking-[0.18em] text-bronze">
        Smart Cellar 3D · sprint 2A · preview only
      </p>
      <h1 className="mt-2 font-display text-display">Storage templates</h1>
      <p className="mt-2 max-w-prose text-small text-ink-2">
        Fourteen templates drawn from their logical layout, with made-up bottles. Nothing here reads
        or writes a cellar. Not available in production.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <form
          className="flex flex-col gap-4 rounded-card border border-hairline bg-surface p-4"
          onSubmit={(e) => e.preventDefault()}
          aria-label="What to show"
        >
          <Choice
            label="Show"
            value={state.sample}
            onChange={(sample) => set({ sample })}
            options={[
              ["template", "A template"],
              ["legacy", "A place from before templates"],
              ["unknown", "A place with an unknown arrangement"],
            ]}
          />
          {isTemplate && (
            <Choice
              label="Template"
              value={state.template}
              onChange={(template) =>
                setState(
                  normalize({
                    sample: "template",
                    template,
                    fill: state.fill,
                    quality: state.quality,
                  }),
                )
              }
              options={STORAGE_TEMPLATE_IDS.map((id) => [id, TEMPLATE_NAMES[id]])}
            />
          )}
          {state.sample === "unknown" && (
            <Choice
              label="Case"
              value={state.unknown}
              onChange={(unknown) => set({ unknown })}
              options={(Object.keys(UNKNOWN_CASES) as UnknownCase[]).map((k) => [
                k,
                UNKNOWN_CASES[k].label,
              ])}
            />
          )}
          {state.sample === "legacy" && (
            <Choice
              label="Kind"
              value={state.legacyKind}
              onChange={(legacyKind) => set({ legacyKind })}
              options={LEGACY_KINDS.map((k) => [k, k])}
            />
          )}
          {state.sample !== "unknown" && (
            <div className="grid grid-cols-3 gap-3">
              <Count
                label="Shelves"
                value={state.rows}
                min={t.rows.min}
                max={t.rows.max}
                onChange={(rows) => set({ rows })}
              />
              <Count
                label="Across"
                value={state.cols}
                min={t.cols.min}
                max={t.cols.max}
                onChange={(cols) => set({ cols })}
              />
              {isTemplate && t.cellCapacity.max > t.cellCapacity.min && (
                <Count
                  label={t.semantics === "ordinal" ? "Per bin" : "Deep"}
                  value={state.cap}
                  min={t.cellCapacity.min}
                  max={t.cellCapacity.max}
                  onChange={(cap) => set({ cap })}
                />
              )}
            </div>
          )}
          {isTemplate && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Choice
                  label="Material"
                  value={state.material}
                  onChange={(material) => set({ material })}
                  options={t.appearance.materials.map((m) => [m, m])}
                />
                <Choice
                  label="Colour"
                  value={state.color}
                  onChange={(color) => set({ color })}
                  options={STORAGE_PALETTES[state.material].map((c) => [c, c])}
                />
                <Choice
                  label="Lighting"
                  value={state.lighting}
                  onChange={(lighting) => set({ lighting })}
                  options={t.appearance.lighting.map((l) => [l, l])}
                />
                <Choice
                  label="Door"
                  value={state.door}
                  onChange={(door) => set({ door })}
                  options={t.appearance.doors.map((d) => [d, d])}
                />
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Choice
              label="Bottles"
              value={state.fill}
              onChange={(fill) => set({ fill })}
              options={[
                ["empty", "none"],
                ["partial", "about half"],
                ["full", "full"],
              ]}
            />
            {state.sample !== "legacy" && (
              <Choice
                label="Detail"
                value={state.quality}
                onChange={(quality) => set({ quality })}
                options={[
                  ["auto", "automatic"],
                  ["high", "high"],
                  ["balanced", "balanced"],
                  ["low", "low"],
                ]}
              />
            )}
          </div>
          <dl
            className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-hairline pt-3 text-caption text-ink-2"
            data-testid="gallery-facts"
          >
            <dt>Renderer</dt>
            <dd data-testid="fact-renderer">{model.renderer}</dd>
            <dt>Family · index means</dt>
            <dd>
              {resolved.layout.family} · {resolved.layout.semantics}
            </dd>
            <dt>Bottles · spots</dt>
            <dd className="tnum">
              {bottles.length} · {resolved.layout.capacity}
            </dd>
            <dt>Arrangement known</dt>
            <dd>{resolved.arrangementKnown ? "yes" : "no"}</dd>
            {resolved.fallbacks.length > 0 && (
              <>
                <dt>Read with fallbacks</dt>
                <dd>{resolved.fallbacks.join(", ")}</dd>
              </>
            )}
          </dl>
          {model.renderer !== "legacy" && <Drawn key={mount} />}
        </form>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-label="3D view">
            <div
              className="relative h-[26rem] overflow-hidden rounded-card border border-hairline bg-[radial-gradient(ellipse_at_50%_30%,var(--color-raised),var(--color-canvas))] sm:h-[34rem]"
              data-testid="gallery-stage"
              style={{ touchAction: "none", cursor: "grab" }}
            >
              {!supported ? (
                <StageNote>
                  This browser cannot draw 3D. The flat picture below shows the same place.
                </StageNote>
              ) : lost ? (
                <StageNote>
                  <span className="flex flex-col items-center gap-3">
                    The browser took the graphics memory back.
                    <Button
                      size="sm"
                      onClick={() => {
                        setLost(false);
                        setMount((n) => n + 1);
                      }}
                    >
                      Show 3D again
                    </Button>
                  </span>
                </StageNote>
              ) : model.renderer === "legacy" ? (
                <LegacyScene
                  key={`legacy-${mount}`}
                  rows={resolved.layout.rows}
                  cols={resolved.layout.cols}
                  kind={state.legacyKind}
                  bottles={bottles}
                  showcase={null}
                  exit="home"
                  layout="top"
                  veil="#f0ebe0"
                  onPick={setSelected}
                  onDismiss={() => setSelected(null)}
                  reducedMotion={reduced}
                  onLost={() => setLost(true)}
                />
              ) : (
                <TemplateScene
                  key={`template-${mount}`}
                  model={model}
                  bottles={bottles}
                  quality={state.quality === "auto" ? undefined : state.quality}
                  selectedId={selected}
                  onPick={setSelected}
                  reducedMotion={reduced}
                  onLost={() => setLost(true)}
                  debug
                />
              )}
            </div>
            <p className="mt-2 text-caption text-ink-3">
              Drag to turn, pinch or scroll to zoom, two fingers or right-drag to slide. Tap a
              bottle to choose it.
              {model.renderer === "legacy" && " This is the existing 3D view, unchanged."}
            </p>
            <p className="mt-2 min-h-6 text-small" role="status" data-testid="gallery-picked">
              {picked ? describe(picked, resolved) : "No bottle chosen."}
            </p>
            {model.renderer !== "legacy" && (
              <p className="text-caption text-ink-3">
                Taking a bottle out to look at it is not part of this view yet (sprint 2B): a tap
                only chooses it.
              </p>
            )}
          </section>

          <section aria-label="Flat view">
            <h2 className="font-display text-headline">The same place, flat</h2>
            <LayoutMap
              className="mt-3"
              resolved={resolved}
              bottles={mapBottles}
              selectedId={selected}
              onSelect={setSelected}
              label={isTemplate ? TEMPLATE_NAMES[state.template] : "Storage place"}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

const wineName = (b: FixtureBottle) =>
  `${b.wine.producer} ${b.wine.name}${b.wine.year ? ` ${b.wine.year}` : ""}`;

/** Where the chosen bottle is, in words that claim no more than is known. */
function describe(b: FixtureBottle, resolved: ReturnType<typeof placeOf>): string {
  const name = wineName(b);
  const index = b.index ?? 1;
  const cell = resolved.layout.cells.find((c) => c.row === b.row && c.col === b.col);
  if (!resolved.arrangementKnown || resolved.layout.semantics === "ordinal")
    return `${name} — in compartment ${b.row}·${b.col}. Where in the compartment it lies is not recorded.`;
  if ((cell?.capacity ?? 1) > 1)
    return `${name} — shelf ${b.row}, position ${b.col}, ${index === 1 ? "at the front" : index === cell!.capacity ? "at the back" : `place ${index} from the front`}.`;
  return `${name} — shelf ${b.row}, position ${b.col}.`;
}

/**
 * What the 3D view last drew, read from the canvas it writes them on (the view's `debug` readout). Looked at twice
 * a second: this is a workbench, not a product screen.
 */
function Drawn() {
  const [seen, setSeen] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    const read = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas',
      );
      if (!canvas) return;
      const d = canvas.dataset;
      setSeen((was) =>
        was.frames === d.frames && was.quality === d.quality && was.template === d.template
          ? was
          : { ...d },
      );
    };
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, []);
  const rows: Array<[string, string | undefined]> = [
    ["Detail level", seen.quality],
    ["Draw calls", seen.calls],
    ["Triangles", seen.triangles && Number(seen.triangles).toLocaleString("en")],
    ["Geometries · textures", seen.geometries && `${seen.geometries} · ${seen.textures}`],
    ["Shader programs", seen.programs],
    ["First picture", seen.firstFrameMs && `${seen.firstFrameMs} ms`],
    ["Frames drawn", seen.frames],
  ];
  return (
    <dl
      className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-hairline pt-3 text-caption text-ink-2 tnum"
      data-testid="gallery-drawn"
    >
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd>{v ?? "…"}</dd>
        </div>
      ))}
    </dl>
  );
}

const control =
  "h-11 w-full rounded-[12px] border border-hairline bg-raised px-3 text-small text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg";

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1 text-caption text-ink-2">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={control}
        value={value}
        disabled={options.length < 2}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Count({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1 text-caption text-ink-2">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={control}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={min === max}
        value={value}
        onChange={(e) => {
          if (e.target.value !== "") onChange(Number(e.target.value));
        }}
      />
    </div>
  );
}
