"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  STORAGE_PALETTES,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  type StorageTemplateId,
} from "@cellr/domain";
import { fixtureBottles, type FixtureBottle } from "@/features/cellar/storage3d/fixtures";
import type {
  InspectableStorageHandle,
  InspectionDetails,
} from "@/features/cellar/storage3d/inspectable-storage";
import { LayoutMap } from "@/features/cellar/storage3d/layout-map";
import { buildModel, type PlacedBottle } from "@/features/cellar/storage3d/model";
import type { ShowcaseState } from "@/features/cellar/storage3d/showcase-machine";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import {
  LEGACY_KINDS,
  UNKNOWN_CASES,
  normalize,
  placeFromKey,
  placeKey,
  toQuery,
  type GalleryState,
  type UnknownCase,
} from "./cellar-gallery-state";

/**
 * Every storage template, to look at (Smart Cellar 3D, sprint 2A): the new layout-driven 3D view and the flat
 * picture of the same place side by side, with made-up bottles. Not a product screen: English only, no account,
 * no database. A place from before templates is shown by the EXISTING 3D view, untouched, for comparison.
 */
const InspectableStorage = dynamic(
  () => import("@/features/cellar/storage3d/inspectable-storage"),
  { ssr: false, loading: () => <StageNote>Loading the 3D view…</StageNote> },
);
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
  // where the inspection stands, for the words beside the picture (the view itself holds the state)
  const [showcase, setShowcase] = useState<{ phase: string; bottleId: string | null }>({
    phase: "idle",
    bottleId: null,
  });
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const storage = useRef<InspectableStorageHandle | null>(null);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const supported = useSyncExternalStore(none, hasWebGL, () => true);

  const set = (patch: Partial<GalleryState>) => {
    setSelected(null);
    // a bottle named in the address is taken out once, when the page opens: not again after a change
    setState((s) => normalize({ ...s, ...patch, inspect: "" }));
  };
  // the address follows what is shown, so a picture can be linked to
  useEffect(() => {
    window.history.replaceState(null, "", `?${toQuery(state)}`);
  }, [state]);

  // the place is built again only when the place changes, not when what is around it does (a studio, a panel)
  const place = placeKey(state);
  const resolved = useMemo(() => placeFromKey(place), [place]);
  const model = useMemo(() => buildModel(resolved, state.fidelity), [resolved, state.fidelity]);
  const bottles = useMemo(
    () => fixtureBottles(resolved.layout, state.fill),
    [resolved, state.fill],
  );
  const mapBottles = useMemo(() => bottles.map((b) => ({ ...b, name: wineName(b) })), [bottles]);
  const picked = selected === null ? null : (bottles.find((b) => b.id === selected) ?? null);
  // what a bottle is, for the panel beside it: made-up wines, the same every time
  const detailsOf = useCallback(
    (placed: PlacedBottle): InspectionDetails | null => {
      const b = bottles.find((x) => x.id === placed.id);
      if (!b) return null;
      const { producer, name, year, place, type } = b.wine;
      return {
        label: { producer, name, year, place, type },
        title: name,
        subtitle: `${producer}${year ? ` · ${year}` : " · non-vintage"}`,
        facts: [
          ["Kind", type],
          ["From", place],
          ["Vintage", year ? String(year) : "non-vintage"],
        ],
        where: whereIs(b, resolved),
      };
    },
    [bottles, resolved],
  );
  const onShowcase = useCallback(
    (now: ShowcaseState) => setShowcase({ phase: now.phase, bottleId: now.bottleId }),
    [],
  );
  const t = STORAGE_TEMPLATES[state.template];
  const isTemplate = state.sample === "template";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6" data-testid="cellar-gallery">
      <p className="text-caption uppercase tracking-[0.18em] text-bronze">
        Smart Cellar 3D · sprints 2A and 2B.1 · preview only
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
              onChange={(template) => {
                // another place: nothing of the last one stays chosen
                setSelected(null);
                setState(
                  normalize({
                    sample: "template",
                    template,
                    fill: state.fill,
                    quality: state.quality,
                    fidelity: state.fidelity,
                    studio: state.studio,
                    panel: state.panel,
                  }),
                );
              }}
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
          {state.sample !== "legacy" && (
            <div
              className="grid grid-cols-2 gap-3 border-t border-hairline pt-3"
              data-testid="gallery-review"
            >
              <Choice
                label="Look"
                value={state.fidelity}
                onChange={(fidelity) => set({ fidelity })}
                options={[
                  ["premium", "premium (2B.2)"],
                  ["classic", "as before (2B.1)"],
                ]}
              />
              <Choice
                label="Studio"
                value={state.studio}
                // what stands behind the place changes nothing of the place: the chosen bottle stays chosen
                onChange={(studio) => setState((was) => normalize({ ...was, studio }))}
                options={[
                  ["light", "light"],
                  ["dark", "dark"],
                ]}
              />
              <Choice
                label="Panel on a narrow screen"
                value={state.panel}
                onChange={(panel) => setState((was) => normalize({ ...was, panel }))}
                options={[
                  ["below", "below the picture"],
                  ["inside", "inside it (no place given)"],
                ]}
              />
            </div>
          )}
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
              className={cn(
                "relative h-[26rem] overflow-hidden rounded-card border border-hairline sm:h-[34rem]",
                // a dark studio is this box's own background: nothing of the app's theme changes
                state.studio === "dark" && state.sample !== "legacy"
                  ? "bg-[radial-gradient(ellipse_at_50%_28%,#4a423b,#1d1a18_62%,#121010)]"
                  : "bg-[radial-gradient(ellipse_at_50%_30%,var(--color-raised),var(--color-canvas))]",
              )}
              data-testid="gallery-stage"
              data-studio={state.studio}
              data-fidelity={state.fidelity}
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
                <InspectableStorage
                  key={`template-${mount}`}
                  handleRef={storage}
                  model={model}
                  bottles={bottles}
                  quality={state.quality === "auto" ? undefined : state.quality}
                  selectedId={selected}
                  onSelect={setSelected}
                  detailsOf={detailsOf}
                  initialInspect={state.inspect || undefined}
                  panelSlot={state.panel === "inside" ? null : panelSlot}
                  reducedMotion={reduced}
                  onLost={() => setLost(true)}
                  onState={onShowcase}
                  debug
                />
              )}
            </div>
            {/* on a narrow screen the panel of the bottle that is out goes here, below the picture */}
            <div ref={setPanelSlot} className="mt-3 empty:hidden" data-testid="inspection-slot" />
            <p className="mt-2 text-caption text-ink-3">
              Drag to turn, pinch or scroll to zoom, two fingers or right-drag to slide.
              {model.renderer === "legacy"
                ? " Tap a bottle to choose it. This is the existing 3D view, unchanged: its own showcase is in the app, not in this gallery."
                : " Tap a bottle to take it out and look at it; drag it to turn it; tap beside it, press Escape or use the close button to put it back."}
            </p>
            <div className="mt-2 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-small" role="status" data-testid="gallery-picked">
                {picked ? describe(picked, resolved) : "No bottle chosen."}
              </p>
              {picked && model.renderer !== "legacy" && (
                // one button, always there while a bottle is chosen, so that the focus can come back to it
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="gallery-inspect"
                  onClick={() =>
                    showcase.phase === "idle"
                      ? storage.current?.inspect(picked.id)
                      : storage.current?.dismiss()
                  }
                >
                  {showcase.phase === "idle" ? "Take it out" : "Put it back"}
                </Button>
              )}
            </div>
            {model.renderer !== "legacy" && (
              <p className="text-caption text-ink-3" data-testid="gallery-showcase-state">
                {showcase.phase === "idle"
                  ? "Every bottle is in its place."
                  : `A bottle is ${
                      showcase.phase === "extracting"
                        ? "on its way out"
                        : showcase.phase === "inspecting"
                          ? "out, on display"
                          : "on its way home"
                    }. Its spot does not change.`}
              </p>
            )}
            <ShowcaseCases />
          </section>

          <section aria-label="Flat view">
            <h2 className="font-display text-headline">The same place, flat</h2>
            <LayoutMap
              className="mt-3"
              resolved={resolved}
              bottles={mapBottles}
              selectedId={selected}
              // while a bottle is out, a press here puts it back: the chosen bottle does not change under it
              onSelect={(id) =>
                showcase.phase === "idle" ? setSelected(id) : storage.current?.dismiss()
              }
              label={isTemplate ? TEMPLATE_NAMES[state.template] : "Storage place"}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * The cases that are hard to get right, one link each: the place, and the bottle that is taken out when it opens.
 * (The bottles of the gallery are the same every time, so a link can name one.)
 */
const SHOWCASE_CASES: ReadonlyArray<readonly [label: string, query: string]> = [
  [
    "Front bottle of a double-depth rack: drawn out",
    "template=rack_double_depth&fill=full&inspect=b-2:3:1",
  ],
  [
    "Rear bottle, front taken: shown, not drawn out",
    "template=rack_double_depth&fill=full&inspect=b-2:3:2",
  ],
  [
    "Rear bottle, front free: drawn out through the free place",
    "template=rack_double_depth&rows=8&cols=1&inspect=b-7:1:2",
  ],
  [
    "A bottle in a diamond bin: lifted from its pile",
    "template=diamond_bins&fill=full&inspect=b-1:2:3",
  ],
  [
    "A bottle on a wall rail: lifted off, away from the wall",
    "template=wall_rails&rows=6&cols=2&fill=full&inspect=b-3:1:1",
  ],
  [
    "Rear bottle on a rail three deep",
    "template=wall_rails&rows=4&cols=2&cap=3&fill=full&inspect=b-2:1:3",
  ],
  ["A cabinet behind a glass door", "template=cabinet_closed&door=glass&fill=full&inspect=b-2:3:1"],
  ["A cabinet with its doors open", "template=cabinet_closed&door=solid&fill=full&inspect=b-2:3:1"],
  ["A dual-zone cooler", "template=cooler_dual&fill=full&inspect=b-6:2:1"],
  [
    "A place whose arrangement is not known",
    "sample=unknown&unknown=bins-as-depth&fill=full&inspect=b-1:2:1",
  ],
];

function ShowcaseCases() {
  return (
    <details
      className="mt-4 rounded-card border border-hairline bg-surface p-4"
      data-testid="showcase-cases"
    >
      <summary className="cursor-pointer text-small font-medium">
        Showcase: the hard cases, one link each
      </summary>
      <ul className="mt-3 grid gap-2 text-small sm:grid-cols-2">
        {SHOWCASE_CASES.map(([label, query]) => (
          <li key={query}>
            <a
              className="text-accent-fg underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg"
              href={`/design/cellar-3d?${query}`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

const wineName = (b: FixtureBottle) =>
  `${b.wine.producer} ${b.wine.name}${b.wine.year ? ` ${b.wine.year}` : ""}`;

/** The chosen bottle and where it is. */
const describe = (b: FixtureBottle, resolved: ReturnType<typeof placeFromKey>): string =>
  `${wineName(b)} — ${whereIs(b, resolved)}`;

/** Where a bottle is, in words that claim no more than is known. */
function whereIs(b: FixtureBottle, resolved: ReturnType<typeof placeFromKey>): string {
  const index = b.index ?? 1;
  const cell = resolved.layout.cells.find((c) => c.row === b.row && c.col === b.col);
  if (!resolved.arrangementKnown || resolved.layout.semantics === "ordinal")
    return `in compartment ${b.row}·${b.col}. Where in the compartment it lies is not recorded.`;
  if ((cell?.capacity ?? 1) > 1)
    return `shelf ${b.row}, position ${b.col}, ${index === 1 ? "at the front" : index === cell!.capacity ? "at the back" : `place ${index} from the front`}.`;
  return `shelf ${b.row}, position ${b.col}.`;
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
        '[data-testid="gallery-stage"] canvas[data-engine]',
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
