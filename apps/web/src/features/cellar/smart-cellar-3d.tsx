"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  zoneOfRow,
  type SmartPlacementView,
  type SmartStorageUnitView,
} from "@cellr/domain";
import { track } from "@/lib/analytics";
import { errorMessage } from "@/lib/api";
import { Button, buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Skeleton } from "@/ui/skeleton";
import { useToast } from "@/ui/toast";
import { EmptyState } from "@/ui/empty-state";
import { Cellar3DView, useReducedMotion, useWebGL } from "./cellar-3d-view";
import { useRacks, useVintageDetail } from "./hooks";
import {
  PlacementPanel,
  type MovableBottle,
  type PlacementDone,
} from "./placement/placement-panel";
import { useSmartMove, useSmartSwap } from "./placement/placement-hooks";
import { ZoneLegend, tempText } from "./placement/zone-legend";
import { imageUrl } from "./label-image";
import { useSmartCapabilities, useSmartPlacements, useSmartUnits } from "./smart-cellar-hooks";
import { resolvedFromView, storedBottlesFrom } from "./storage3d/from-api";
import type {
  InspectableStorageHandle,
  InspectionDetails,
  InspectionLabels,
} from "./storage3d/inspectable-storage";
import { LayoutMap } from "./storage3d/layout-map";
import { buildModel, placeBottles, type PlacedBottle } from "./storage3d/model";
import { labelSpecOf, selectedIn, whereOf } from "./storage3d/product-details";
import type { ShowcaseState } from "./storage3d/showcase-machine";
import { placeLine } from "./wine-visuals";

/** three.js and the new storage view are large: downloaded only when a place with a template is opened in 3D. */
const InspectableStorage = dynamic(() => import("./storage3d/inspectable-storage"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

/**
 * Which place was open and which bottle was chosen, kept for the life of this browser tab: going to a wine's page
 * and coming back finds the 3D cellar as it was. (As the cellar screen keeps its search and view.)
 */
const memory: { unitId: string | null; selection: Selection | null } = {
  unitId: null,
  selection: null,
};
interface Selection {
  unitId: string;
  bottleId: string;
}
const rememberUnit = (unitId: string) => {
  memory.unitId = unitId;
};
const rememberSelection = (selection: Selection | null) => {
  memory.selection = selection;
};

/**
 * The view's own readout for the browser tests and the measuring bench (counters on the canvas, where a bottle is
 * on the screen). Off unless this tab asked for it; it shows nothing a person does not already see.
 */
const DEBUG_FLAG = "cellr:3d-debug";
const noSubscription = () => () => {};
const useDebugReadout = () =>
  useSyncExternalStore(
    noSubscription,
    () => {
      try {
        return window.sessionStorage.getItem(DEBUG_FLAG) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );

/**
 * THE CELLAR IN 3D, WITH THE NEW STORAGE VIEW WHERE A PLACE HAS A TEMPLATE (Smart Cellar 3D, sprint 2B.3). Mounted
 * only where the server said the new renderer may be used (lib/smart-cellar-renderer-gate.ts): an internal preview.
 *
 * One place at a time, chosen from one row of places. For each place the rule is the domain's, as the Smart Cellar
 * API reports it:
 *   - a place from before templates (`legacy`) is drawn by the EXISTING 3D view, exactly as it always was: nothing
 *     is made up about furniture nobody chose;
 *   - a place with a template is drawn by the new view; when its arrangement is not known, as the neutral picture;
 *   - a database without the Smart Cellar step, an empty cellar: the existing view, whole;
 *   - any other failure (no connection, no access, a server error) is SAID, with a way to try again, and the
 *     existing view is shown under it so the cellar stays usable.
 * Only one 3D scene exists at any time. Nothing here writes: looking at a bottle never changes where it is.
 */
/** Whether bottles may be placed here (the server's decision, lib/smart-cellar-placement-gate.ts; sprint 4). */
export interface PlacementSwitch {
  open: boolean;
  canWrite: boolean;
  /** Placement advice (sprint 5, lib/smart-cellar-advice-gate.ts): read-only, only where placement is open. */
  advice?: boolean;
}

export default function SmartCellar3D({
  onShowRacks,
  placement = { open: false, canWrite: false },
  builderOpen = false,
}: {
  onShowRacks: () => void;
  placement?: PlacementSwitch;
  /** The Rack Builder may be opened (for "Edit zones"). */
  builderOpen?: boolean;
}) {
  const t = useTranslations("smart3d");
  const tp = useTranslations("placement");
  const te = useTranslations();
  const toast = useToast();
  const move = useSmartMove();
  const swap = useSmartSwap();
  // Placing: the bottle being moved (or null: a spot first), and the spot ringed in the picture. Only on screen;
  // nothing moves until the server says so.
  const [placing, setPlacing] = useState<{ bottle: MovableBottle | null } | null>(null);
  const [target, setTarget] = useState<{
    unitId: string;
    row: number;
    col: number;
    index: number;
  } | null>(null);
  // Bottles without a place, from the racks the app already reads (asked for only where placement is shown).
  const racks = useRacks(placement.open);
  const capabilities = useSmartCapabilities(true);
  const units = useSmartUnits(true);
  const [unitId, setUnitIdState] = useState<string | null>(() => memory.unitId);
  const [selection, setSelectionState] = useState<Selection | null>(() => memory.selection);
  // Counted once each time the 3D cellar is opened, as the existing view counts it.
  useEffect(() => track("3d_cellar_opened"), []);

  const setSelection = useCallback((next: Selection | null) => {
    rememberSelection(next);
    setSelectionState(next);
  }, []);

  // A database without the Smart Cellar step: the cellar in 3D is the existing one, and nothing is said about it.
  if (capabilities.data?.schema.reads === "missing")
    return (
      <div data-testid="smart-3d" data-mode="schema-missing">
        <Cellar3DView onShowRacks={onShowRacks} />
      </div>
    );

  if (!units.data) {
    // Not "this is not set up": a failure of another kind. It is said, and the existing view stays usable.
    const failure = units.error ?? capabilities.error;
    if (failure && !units.isFetching && !capabilities.isFetching)
      return (
        <div className="flex flex-col gap-4" data-testid="smart-3d" data-mode="failed">
          <div
            role="alert"
            data-testid="smart-3d-failed"
            className="flex flex-col gap-2 rounded-card border border-hairline bg-raised p-4"
          >
            <p className="font-medium text-ink">{t("loadFailedTitle")}</p>
            <p className="text-small text-ink-2">
              {t("loadFailedBody", {
                reason: errorMessage(failure, (key) => te(key), ERROR_MESSAGES),
              })}
            </p>
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void capabilities.refetch();
                  void units.refetch();
                }}
              >
                {te("common.retry")}
              </Button>
            </div>
          </div>
          <Cellar3DView onShowRacks={onShowRacks} />
        </div>
      );
    return <Skeleton className="h-[26rem]" />;
  }

  // No place at all: the existing view's own invitation to build a cellar.
  if (units.data.length === 0)
    return (
      <div data-testid="smart-3d" data-mode="empty">
        <Cellar3DView onShowRacks={onShowRacks} />
      </div>
    );

  const unit = units.data.find((u) => u.id === unitId) ?? units.data[0]!;
  const choose = (id: string) => {
    if (id === unit.id) return;
    rememberUnit(id);
    setUnitIdState(id);
    // a bottle chosen in one place is not chosen in another
    setSelection(null);
  };

  const unplaced: MovableBottle[] = (racks.data?.unplaced ?? []).map((b) => ({
    bottleId: b.bottleId,
    name: `${b.producer} ${b.wineName} ${formatVintage(b.year)}`,
    from: null,
  }));
  const startPlacing = (bottle: MovableBottle | null) => {
    setPlacing({ bottle });
    if (bottle?.from && bottle.from.locationId !== unit.id) choose(bottle.from.locationId);
  };
  const undoFailed = (e: unknown) =>
    toast.show(
      errorMessage(e, (key) => te(key), ERROR_MESSAGES),
      { tone: "error" },
    );
  /** The panel is gone: focus goes back to where placing starts, not to the top of the page. */
  const backToStart = () =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="placement-start"]')?.focus(),
    );
  const done = (result: PlacementDone) => {
    setPlacing(null);
    setTarget(null);
    backToStart();
    const undoable = result.undoable !== false;
    // where a moved bottle is now, in one sentence ("has no place now" for a take-off)
    const movedText = (r: Extract<PlacementDone, { kind: "moved" }>) =>
      r.result.to === null
        ? tp("takenOff", { wine: r.bottle.name })
        : tp("moved", { wine: r.bottle.name, where: r.where });
    if (result.kind === "moved" && result.result.outcome === "already_there") {
      // nothing was changed by this request (a repeat, or someone had put it there): nothing to undo
      toast.show(
        result.result.to === null
          ? tp("alreadyOff", { wine: result.bottle.name })
          : tp("alreadyThere", { wine: result.bottle.name, where: result.where }),
      );
    } else if (result.kind === "moved" && !undoable) {
      toast.show(movedText(result));
    } else if (result.kind === "swapped" && !undoable) {
      toast.show(tp("swapped", { a: result.bottle.name, b: result.other.name }));
    } else if (result.kind === "moved") {
      const { from, to } = result.result;
      toast.show(movedText(result), {
        action: {
          label: tp("undo"),
          // back to where it was, only while it is still where this move put it
          onClick: () =>
            void move
              .mutateAsync({ bottleId: result.bottle.bottleId, move: { from: to, to: from } })
              .then(() => toast.show(tp("undone")))
              .catch(undoFailed),
        },
      });
    } else {
      const { self, other } = result.result;
      toast.show(tp("swapped", { a: result.bottle.name, b: result.other.name }), {
        action: {
          label: tp("undo"),
          onClick: () =>
            void swap
              .mutateAsync({
                bottleId: self.bottleId,
                swap: { with: other.bottleId, expected: { self: self.spot, other: other.spot } },
              })
              .then(() => toast.show(tp("undone")))
              .catch(undoFailed),
        },
      });
    }
  };

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="smart-3d"
      data-mode="ready"
      data-placing={placing ? "true" : "false"}
      data-unit={unit.id}
      data-unit-renderer={unit.legacy ? "legacy" : "smart"}
    >
      {units.data.length > 1 && (
        <div
          className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0"
          data-testid="smart-3d-units"
        >
          {units.data.map((u) => (
            <Chip key={u.id} selected={u.id === unit.id} onClick={() => choose(u.id)}>
              {u.label}
            </Chip>
          ))}
        </div>
      )}
      {unit.legacy ? (
        // from before templates: the existing view, with its own details, actions and words
        <Cellar3DView onShowRacks={onShowRacks} only={unit.id} />
      ) : (
        <SmartUnitStage
          key={unit.id}
          listed={unit}
          selection={selection}
          onSelect={setSelection}
          onShowRacks={onShowRacks}
          builderOpen={builderOpen}
          zones={placement.open}
          target={target && target.unitId === unit.id ? target : null}
          onMove={placement.open && !placing ? (b) => startPlacing(b) : undefined}
        />
      )}
      {placement.open && !placing && (
        <div className="flex flex-wrap items-center gap-2" data-testid="placement-entry">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => startPlacing(null)}
            data-testid="placement-start"
          >
            {tp("placeHere")}
          </Button>
        </div>
      )}
      {placing && (
        <PlacementPanel
          key={placing.bottle?.bottleId ?? "spot-first"}
          bottle={placing.bottle}
          units={units.data}
          unitId={unit.id}
          onUnit={choose}
          unplaced={unplaced}
          onTarget={setTarget}
          onDone={done}
          onCancel={() => {
            setPlacing(null);
            setTarget(null);
            backToStart();
          }}
          canWrite={placement.canWrite}
          advice={placement.advice === true}
          builderHref={builderOpen ? "/cellar/builder" : null}
        />
      )}
      {placement.open && !placing && unplaced.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="placement-unplaced">
          <h2 className="text-small font-medium text-ink">
            {tp("unplacedTitle", { count: unplaced.length })}
          </h2>
          <ul className="flex flex-col gap-1">
            {unplaced.slice(0, 20).map((b) => (
              <li
                key={b.bottleId}
                className="flex items-center justify-between gap-3 text-small text-ink"
              >
                <span className="min-w-0 truncate">{b.name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => startPlacing(b)}
                  data-bottle={b.bottleId}
                >
                  {tp("place")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** One place with a template, in the new view, with what its bottles really are. */
const NO_ZONES: SmartStorageUnitView["zones"] = [];

function SmartUnitStage({
  listed,
  selection,
  onSelect,
  onShowRacks,
  builderOpen,
  zones,
  target,
  onMove,
}: {
  /** The place as the list of places has it: shown until its bottles are in. */
  listed: SmartStorageUnitView;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onShowRacks: () => void;
  builderOpen: boolean;
  /** Temperature zones in daily use (sprint 4, behind the placement gate): the legend and a bottle's zone. */
  zones: boolean;
  /** A spot a bottle is about to be put on: ringed in the picture. */
  target: { row: number; col: number; index: number } | null;
  /** Placement is on here: a bottle can be moved (from its panel, or from the flat picture). */
  onMove: ((bottle: MovableBottle) => void) | undefined;
}) {
  const tp = useTranslations("placement");
  const t = useTranslations("smart3d");
  const t3 = useTranslations("cellar3d");
  const te = useTranslations();
  const tKinds = useTranslations("storageKinds");
  const tTypes = useTranslations("wineTypes");
  const tRacks = useTranslations("racks");
  const tRack = useTranslations("rack");
  const tShowcase = useTranslations("showcase");
  const locale = useLocale();
  const webgl = useWebGL();
  const reduced = useReducedMotion();
  const debug = useDebugReadout();
  const query = useSmartPlacements(listed.id);
  const data = query.data;
  const unit = data?.unit ?? listed;

  const stage = useRef<HTMLDivElement>(null);
  const handle = useRef<InspectableStorageHandle | null>(null);
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const [lost, setLost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [touched, setTouched] = useState(false);
  /** The bottle that is out of its place right now (its details are only asked for then). */
  const [outId, setOutId] = useState<string | null>(null);

  // The same objects come back from a refresh that changed nothing (the query cache shares structure), so the
  // model, the bottles and with them a bottle that is out all stay as they are.
  const placeView = data?.unit;
  const placements = data?.placements;
  const model = useMemo(
    () => (placeView ? buildModel(resolvedFromView(placeView)) : null),
    [placeView],
  );
  const bottles = useMemo(() => storedBottlesFrom(placements ?? []), [placements]);
  const byId = useMemo(
    () => new Map<string, SmartPlacementView>((placements ?? []).map((p) => [p.bottleId, p])),
    [placements],
  );
  // Bottles on a spot this place does not have are never drawn elsewhere and never dropped: they are listed.
  const stranded = useMemo(
    () => (model ? placeBottles(model, bottles).stranded : []),
    [model, bottles],
  );

  const out = outId ? (byId.get(outId) ?? null) : null;
  // The wine's own details (back label, appellation, how many there are): asked for when a bottle is taken out,
  // once per vintage, never for the whole place up front.
  const detail = useVintageDetail(out?.vintageId ?? null).data;
  const outDetail = detail && out && detail.vintageId === out.vintageId ? detail : null;

  const name = useCallback(
    (p: SmartPlacementView) => `${p.producer} ${p.wineName} ${formatVintage(p.year)}`,
    [],
  );
  const unitLabel = unit.label;
  const unitMeaning = unit.indexMeaning;
  const unitKnown = unit.arrangementKnown;
  const unitZones = zones ? unit.zones : NO_ZONES;
  const detailsOf = useCallback(
    (placed: PlacedBottle): InspectionDetails | null => {
      const p = byId.get(placed.id);
      if (!p) return null;
      const from = placeLine(p.region, p.countryCode, locale);
      const mine = outDetail && outDetail.vintageId === p.vintageId ? outDetail : null;
      const where = whereOf({ indexMeaning: unitMeaning, arrangementKnown: unitKnown }, p);
      const facts: Array<readonly [string, string]> = [
        [t("facts.kind"), tTypes(p.type)],
        ...(from ? [[t("facts.origin"), from] as const] : []),
        [t("facts.vintage"), formatVintage(p.year)],
        ...(mine?.wine.appellation
          ? [[t("facts.appellation"), mine.wine.appellation] as const]
          : []),
        ...(mine
          ? [
              [
                t("facts.inCellar"),
                t("facts.inCellarCount", { count: mine.bottles.length }),
              ] as const,
            ]
          : []),
        // the zone of its shelf, when the place has zones: what it is for and what it is SET to (never a reading)
        ...(unitZones.length > 0
          ? (() => {
              const zone = zoneOfRow(unitZones, p.row);
              return zone
                ? [
                    [
                      t("facts.zone"),
                      zone.targetTempC === null
                        ? tp(`zone.${zone.purpose}`)
                        : tp("zoneSet", {
                            zone: tp(`zone.${zone.purpose}`),
                            temp: tempText(locale, zone.targetTempC),
                          }),
                    ] as const,
                  ]
                : [];
            })()
          : []),
      ];
      return {
        label: labelSpecOf(p, from, imageUrl, mine?.backImage ?? null),
        title: p.wineName,
        subtitle: t("subtitle", { producer: p.producer, year: formatVintage(p.year) }),
        facts,
        where: t(`where.${where.kind}`, {
          unit: unitLabel,
          row: where.row,
          col: where.col,
          index: where.index,
        }),
        actions: (
          <div className="flex flex-col gap-2">
            <Link
              href={`/cellar/${p.vintageId}`}
              data-testid="smart-3d-wine-link"
              className={buttonStyles({ variant: "primary", block: true })}
            >
              {t("wineDetails")}
            </Link>
            {onMove && (
              <Button
                variant="secondary"
                block
                data-testid="smart-3d-move"
                onClick={() => {
                  handle.current?.dismiss();
                  onMove({
                    bottleId: p.bottleId,
                    name: name(p),
                    from: { locationId: p.locationId, row: p.row, col: p.col, index: p.index },
                  });
                }}
              >
                {tp("moveAction")}
              </Button>
            )}
          </div>
        ),
      };
    },
    [
      byId,
      locale,
      outDetail,
      unitLabel,
      unitMeaning,
      unitKnown,
      unitZones,
      onMove,
      name,
      t,
      tp,
      tTypes,
    ],
  );

  const labels: InspectionLabels = useMemo(
    () => ({
      close: tShowcase("putBack"),
      turn: tShowcase("spin"),
      how: {
        clear_path: t("how.clear_path"),
        behind_bottle: t("how.behind_bottle"),
        behind_door: t("how.behind_door"),
        blocked: t("how.blocked"),
        pile: t("how.pile"),
        unknown_arrangement: t("how.unknown_arrangement"),
      },
    }),
    [t, tShowcase],
  );

  const unitKey = listed.id;
  const select = useCallback(
    (id: string | null) => onSelect(id ? { unitId: unitKey, bottleId: id } : null),
    [onSelect, unitKey],
  );
  const onState = useCallback(
    (state: ShowcaseState) => {
      const id = state.phase === "idle" ? null : state.bottleId;
      setOutId((was) => {
        // on a narrow screen the page may be scrolled past the picture: bring it back as the bottle leaves
        if (id && !was)
          stage.current?.scrollIntoView({
            block: "nearest",
            behavior: reduced ? "auto" : "smooth",
          });
        return id;
      });
    },
    [reduced],
  );

  const meta = (
    <p className="text-small text-ink-2 tnum" data-testid="smart-3d-meta">
      {unit.label === tKinds(unit.kind) ? "" : `${tKinds(unit.kind)} · `}
      {tRacks("unitMeta", { used: unit.occupied, capacity: unit.capacity, free: unit.free })}
    </p>
  );

  if (!webgl) {
    // No 3D on this device. With placement on, the flat picture of the same place stands in, with the same
    // choices (a bottle chosen here can be moved); without it, the existing message and the racks, as before.
    if (!onMove || !data || !model)
      return (
        <EmptyState
          title={t3("noWebglTitle")}
          body={t3("noWebglBody")}
          action={
            <Button size="lg" onClick={onShowRacks}>
              {t3("showRacks")}
            </Button>
          }
        />
      );
    const flatSelected = selectedIn(selection, unit.id, data.placements);
    const chosen = flatSelected ? (byId.get(flatSelected) ?? null) : null;
    return (
      <>
        {meta}
        {zones && <ZoneLegend unit={unit} occupants={data.placements} builderOpen={builderOpen} />}
        <div data-testid="smart-3d-flat" className="rounded-card bg-raised p-3">
          <LayoutMap
            resolved={resolvedFromView(unit)}
            bottles={data.placements.map((p) => ({
              id: p.bottleId,
              row: p.row,
              col: p.col,
              index: p.index,
              type: p.type,
              name: name(p),
            }))}
            selectedId={flatSelected}
            onSelect={select}
            label={unit.label}
          />
        </div>
        {chosen && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface p-3 ring-1 ring-hairline"
            data-testid="smart-3d-flat-chosen"
          >
            <span className="text-small text-ink">{name(chosen)}</span>
            <Button
              size="sm"
              variant="secondary"
              data-testid="smart-3d-move"
              onClick={() =>
                onMove({
                  bottleId: chosen.bottleId,
                  name: name(chosen),
                  from: {
                    locationId: chosen.locationId,
                    row: chosen.row,
                    col: chosen.col,
                    index: chosen.index,
                  },
                })
              }
            >
              {tp("moveAction")}
            </Button>
          </div>
        )}
      </>
    );
  }

  if (!data || !model) {
    if (query.isError && !query.isFetching)
      return (
        <>
          {meta}
          <div
            role="alert"
            data-testid="smart-3d-unit-failed"
            className="flex flex-col items-start gap-2 rounded-card border border-hairline bg-raised p-4"
          >
            <p className="font-medium text-ink">{t("unitFailedTitle")}</p>
            <p className="text-small text-ink-2">
              {errorMessage(query.error, (key) => te(key), ERROR_MESSAGES)}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
                {te("common.retry")}
              </Button>
              <Button size="sm" variant="ghost" onClick={onShowRacks}>
                {t3("showRacks")}
              </Button>
            </div>
          </div>
        </>
      );
    return (
      <>
        {meta}
        <Skeleton className="h-[26rem]" />
      </>
    );
  }

  // The place has no template any more (it was changed since the list was read): the existing view draws it.
  if (model.renderer === "legacy") return <Cellar3DView onShowRacks={onShowRacks} only={unit.id} />;

  const selectedId = selectedIn(selection, unit.id, data.placements);
  const open = outId !== null;

  return (
    <>
      {meta}
      {zones && <ZoneLegend unit={unit} occupants={data.placements} builderOpen={builderOpen} />}
      {!unit.arrangementKnown && (
        <p className="text-small text-ink-2" data-testid="smart-3d-not-known">
          {t("notKnown")}
        </p>
      )}
      {query.isError && (
        <p role="status" className="text-small text-ink-2" data-testid="smart-3d-refresh-failed">
          {t("refreshFailed")}
        </p>
      )}
      {/* The card takes the place's own proportions on a phone (a tall cooler, a wide rack), as the existing view does. */}
      <div
        className="relative h-[clamp(20rem,calc((100vw-2.5rem)*var(--unit-ratio)+3rem),min(68vh,34rem))] sm:h-[min(68vh,34rem)]"
        style={{ "--unit-ratio": unit.rows / unit.cols } as CSSProperties}
      >
        <div
          ref={stage}
          role="group"
          aria-label={t3("canvasLabel", { unit: unit.label })}
          className="absolute inset-0 overflow-hidden rounded-card border border-hairline bg-raised shadow-raised"
          style={{
            backgroundImage:
              "radial-gradient(120% 90% at 50% 30%, color-mix(in srgb, var(--ink) 9%, transparent), transparent 70%)",
          }}
          data-testid="smart-3d-stage"
          data-renderer={model.renderer}
          data-template={unit.templateId ?? ""}
          data-bottles={data.placements.length}
          data-stranded={stranded.length}
          data-selected={selectedId ?? ""}
          onPointerDown={() => setTouched(true)}
        >
          {!lost && (
            <InspectableStorage
              key={`${unit.id}:${attempt}`}
              handleRef={handle}
              model={model}
              bottles={bottles}
              selectedId={selectedId}
              onSelect={select}
              detailsOf={detailsOf}
              labels={labels}
              panelSlot={panelSlot}
              reducedMotion={reduced}
              onState={onState}
              onLost={() => {
                setLost(true);
                setOutId(null);
              }}
              debug={debug}
              target={target}
            />
          )}
          {lost && (
            <div
              role="alert"
              data-testid="smart-3d-lost"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-raised/95 px-6 text-center"
            >
              <p className="font-display text-title text-ink">{t3("lostTitle")}</p>
              <p className="max-w-sm text-small text-ink-2">{t3("lostBody")}</p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => {
                    setLost(false);
                    setAttempt((n) => n + 1);
                  }}
                >
                  {t3("lostRetry")}
                </Button>
                <Button variant="ghost" onClick={onShowRacks}>
                  {t3("showRacks")}
                </Button>
              </div>
            </div>
          )}
          <p
            className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4 transition-opacity duration-500"
            style={{ opacity: touched || open || lost ? 0 : 1 }}
          >
            {/* no blur behind it: a blurred layer over the picture has to be drawn again with every frame */}
            <span className="max-w-full rounded-full bg-surface/90 px-4 py-1.5 text-center text-caption text-ink-2 ring-1 ring-hairline">
              {data.placements.length === 0 ? t("empty") : t("hint")}
            </span>
          </p>
        </div>
      </div>
      {/* on a narrow screen the panel of the bottle that is out goes here, right under the picture */}
      <div ref={setPanelSlot} className="empty:hidden" data-testid="smart-3d-panel-slot" />

      {stranded.length > 0 && (
        <div
          className="rounded-card border border-hairline bg-raised p-4"
          data-testid="smart-3d-stranded"
        >
          <p className="text-small text-ink">{t("stranded", { count: stranded.length })}</p>
          <ul
            className="mt-2 flex flex-col gap-1 text-small text-ink-2"
            aria-label={t("strandedList")}
          >
            {stranded.map((b) => {
              const p = byId.get(b.id);
              return p ? (
                <li key={b.id}>
                  <Link href={`/cellar/${p.vintageId}`} className="underline underline-offset-2">
                    {t("strandedBottle", {
                      wine: name(p),
                      row: p.row,
                      col: p.col,
                      index: p.index,
                    })}
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
        </div>
      )}

      {/* The same bottles for keyboard and screen-reader users; visible while one has focus. */}
      <ul
        className="sr-only focus-within:not-sr-only focus-within:flex focus-within:flex-col focus-within:gap-1 focus-within:rounded-card focus-within:bg-raised focus-within:p-3"
        aria-label={t3("listLabel", { unit: unit.label })}
        data-testid="smart-3d-list"
      >
        {data.placements
          .filter((p) => !stranded.some((s) => s.id === p.bottleId))
          .map((p) => (
            <li key={p.bottleId}>
              <button type="button" onClick={() => handle.current?.inspect(p.bottleId)}>
                {tRack("cellBottle", { wine: name(p), row: p.row, col: p.col })}
              </button>
            </li>
          ))}
      </ul>
    </>
  );
}
