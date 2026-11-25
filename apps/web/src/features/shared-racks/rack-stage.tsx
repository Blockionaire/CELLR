"use client";

import dynamic from "next/dynamic";
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
  formatVintage,
  resolveSharedRack,
  type SharedRackBottleView,
  type SharedRackSpot,
} from "@cellr/domain";
import { useReducedMotion, useWebGL } from "@/features/cellar/cellar-3d-view";
import { useRacks } from "@/features/cellar/hooks";
import { spotMarkers, type FreeSpot } from "@/features/cellar/quick-add/spots";
import type {
  InspectableStorageHandle,
  InspectionDetails,
  InspectionLabels,
} from "@/features/cellar/storage3d/inspectable-storage";
import { buildModel, type PlacedBottle } from "@/features/cellar/storage3d/model";
import { placeLine } from "@/features/cellar/wine-visuals";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { PlusIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useToast } from "@/ui/toast";
import {
  useMoveBottle,
  usePlaceBottle,
  useSharedRackBottles,
  useSharedRackMembers,
  useSharedRacks,
  useTakeOutBottle,
} from "./hooks";
import { PeopleIcon } from "./icons";
import {
  RACK_NOT_FOUND_MESSAGE,
  bottleName,
  freeSpotsOf,
  isNotSetUp,
  matchesOwner,
  ownerChoices,
  refusalKind,
  spotOf,
  storedSharedBottles,
  validFilter,
  type Candidate,
  type OwnerFilter,
} from "./logic";
import { RackGrid } from "./rack-grid";
import {
  ActivitySheet,
  AddBottleSheet,
  PeopleSheet,
  SettingsSheet,
  TakeOutSheet,
  useErrorText,
} from "./sheets";

/** three.js and the storage view are large: downloaded only when a rack is drawn in 3D. */
const InspectableStorage = dynamic(
  () => import("@/features/cellar/storage3d/inspectable-storage"),
  { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-none" /> },
);

/**
 * The 3D view's own readout for the browser tests (where a spot is on the screen), as the cellar's 3D screen has
 * it: off unless this tab asked for it; it shows nothing a person does not already see.
 */
const noSubscription = () => () => {};
const useDebugReadout = () =>
  useSyncExternalStore(
    noSubscription,
    () => {
      try {
        return window.sessionStorage.getItem("cellr:3d-debug") === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );

/** What the person is doing: looking, choosing a spot for a bottle of their own, or for a bottle being moved. */
type Mode = { kind: "view" } | { kind: "add" } | { kind: "move"; bottle: SharedRackBottleView };

/**
 * ONE SHARED RACK (ADR-010), drawn by the cellar's own storage view from the rack's layout, with every bottle known
 * by its placement id and its label drawn from the wine's names (no photo crosses households).
 *
 * Everything can be done two ways: in the 3D picture, and in the flat grid of shelves and spots (no 3D on the device,
 * a 3D picture that stopped, a keyboard, a screen reader, or simply by choice). Both show the same rack from the same
 * read of the server.
 *
 * Nothing is kept aside: after every change, and after every refusal, the rack is read again. A change the server
 * refuses (a spot just taken, a bottle moved or taken out meanwhile) is said, the rack is shown as it is now, and
 * nothing is tried again on the person's behalf. Someone who is no longer a member sees that, and nothing of the rack.
 */
export function SharedRackStage({
  rackId,
  onGone,
  onShowRacks,
}: {
  rackId: string;
  /** Back to my own places (the rack is not mine to see any more, or I left it). */
  onGone: () => void;
  onShowRacks: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const t3 = useTranslations("cellar3d");
  const tSmart = useTranslations("smart3d");
  const tShowcase = useTranslations("showcase");
  const tTypes = useTranslations("wineTypes");
  const tc = useTranslations("common");
  const locale = useLocale();
  const webgl = useWebGL();
  const reduced = useReducedMotion();
  const debug = useDebugReadout();
  const toast = useToast();
  const say = useErrorText();

  const list = useSharedRacks();
  const query = useSharedRackBottles(rackId);
  const data = query.data;
  const membersQuery = useSharedRackMembers(rackId, data !== undefined);
  const members = membersQuery.data?.members;
  const place = usePlaceBottle(rackId);
  const move = useMoveBottle(rackId);
  const takeOut = useTakeOutBottle(rackId);

  const [filter, setFilter] = useState<OwnerFilter>("all");
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [addSpot, setAddSpot] = useState<SharedRackSpot | null>(null);
  const [sheet, setSheet] = useState<"people" | "activity" | "settings" | null>(null);
  const [historyOf, setHistoryOf] = useState<{ placementId: string; name: string } | null>(null);
  // a sheet says it is closed a moment after it was asked to (its way out is animated): by then another sheet may be
  // the open one, and that one stays
  const closeSheet = (which: "people" | "activity" | "settings") =>
    setSheet((now) => (now === which ? null : now));
  const [takeOutFor, setTakeOutFor] = useState<SharedRackBottleView | null>(null);
  const [takenOut, setTakenOut] = useState<{ vintageId: string | null } | null>(null);
  const [flat, setFlat] = useState(false);
  const [lost, setLost] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelSlot, setPanelSlot] = useState<HTMLElement | null>(null);
  const handle = useRef<InspectableStorageHandle | null>(null);
  // my own cellar, for where one of my bottles goes after it is taken out (asked for only then)
  const racks = useRacks(takeOutFor?.mine === true);

  const rack = data?.rack;
  const bottles = useMemo(() => data?.bottles ?? [], [data]);
  const resolved = useMemo(() => (rack ? resolveSharedRack(rack) : null), [rack]);
  const model = useMemo(() => (resolved ? buildModel(resolved) : null), [resolved]);
  const byId = useMemo(() => new Map(bottles.map((b) => [b.placementId, b])), [bottles]);
  const choices = useMemo(() => ownerChoices(bottles, members ?? []), [bottles, members]);
  const active = validFilter(filter, choices);
  const offering = mode.kind !== "view";
  // while a spot is being chosen every bottle is shown: a spot is free only when nobody's bottle is on it
  const shown = useMemo(
    () => (offering ? bottles : bottles.filter((b) => matchesOwner(b, active))),
    [bottles, active, offering],
  );
  const shownIds = useMemo(() => new Set(shown.map((b) => b.placementId)), [shown]);
  const stored = useMemo(() => storedSharedBottles(shown), [shown]);
  const free = useMemo(
    () => (offering && resolved ? freeSpotsOf(resolved, bottles) : []),
    [offering, resolved, bottles],
  );
  const markers = useMemo(
    () => (offering && model ? spotMarkers(model, free) : null),
    [offering, model, free],
  );
  const writes = list.data?.writes ?? false;
  const can = rack?.permissions;
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  // spots on offer: a bottle that is out goes back first
  useEffect(() => {
    if (offering) handle.current?.dismiss();
  }, [offering]);
  // Escape stops choosing a spot
  useEffect(() => {
    if (!offering || addSpot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setMode({ kind: "view" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offering, addSpot]);

  const spotText = useCallback(
    (s: { row: number; col: number }) => t("spot", { row: s.row, col: s.col }),
    [t],
  );
  /** A change the server refused: said as what it is; the rack is read again by the change itself. */
  const refused = (error: unknown) => {
    const kind = refusalKind(error, RACK_NOT_FOUND_MESSAGE);
    toast.show(
      kind === "gone"
        ? t("stage.gone")
        : kind === "refresh"
          ? `${say(error)} ${t("stage.refreshed")}`
          : say(error),
      { tone: "error" },
    );
    setMode({ kind: "view" });
    setAddSpot(null);
  };
  const doPlace = (candidate: Candidate) => {
    if (!addSpot) return;
    const to = addSpot;
    place.mutate(
      { bottleId: candidate.bottleId, to },
      {
        onSuccess: (out) => {
          toast.show(t("stage.placed", { wine: candidate.name, spot: spotText(to) }));
          setAddSpot(null);
          setMode({ kind: "view" });
          setSelectedId(out.placementId);
        },
        onError: refused,
      },
    );
  };
  const doMove = (bottle: SharedRackBottleView, to: SharedRackSpot) =>
    move.mutate(
      // from the spot it was SEEN on when Move was chosen: the server moves it only while it is still there
      { placementId: bottle.placementId, from: spotOf(bottle), to },
      {
        onSuccess: (out) => {
          toast.show(
            t(out.outcome === "already_there" ? "stage.alreadyThere" : "stage.moved", {
              wine: bottleName(bottle),
              spot: spotText(to),
            }),
          );
          setMode({ kind: "view" });
          setSelectedId(bottle.placementId);
        },
        onError: refused,
      },
    );
  const onSpot = (spot: FreeSpot) => {
    if (move.isPending || place.isPending) return;
    if (mode.kind === "add") setAddSpot(spot);
    else if (mode.kind === "move") doMove(mode.bottle, spot);
  };
  const doTakeOut = () => {
    const bottle = takeOutFor;
    if (!bottle) return;
    const vintageId =
      (bottle.bottleId &&
        racks.data?.unplaced.find((b) => b.bottleId === bottle.bottleId)?.vintageId) ||
      null;
    takeOut.mutate(
      { placementId: bottle.placementId, from: spotOf(bottle) },
      {
        onSuccess: () => {
          setSelectedId(null);
          if (bottle.mine) return setTakenOut({ vintageId });
          toast.show(
            t("stage.takenOutTheirs", {
              wine: bottleName(bottle),
              owner: bottle.owner.name ?? t("someone"),
            }),
          );
          setTakeOutFor(null);
        },
        onError: (e) => {
          setTakeOutFor(null);
          refused(e);
        },
      },
    );
  };

  const when = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);
  const factsOf = useCallback(
    (b: SharedRackBottleView): Array<readonly [string, string]> => [
      [
        t("stage.factOwner"),
        b.mine
          ? t("stage.ownerYou")
          : b.owner.isMember
            ? (b.owner.name ?? t("someone"))
            : t("stage.ownerFormer", { name: b.owner.name ?? t("someone") }),
      ],
      [
        t("stage.factPlaced"),
        t("stage.placedBy", {
          name: b.placedBy ?? t("someone"),
          date: when.format(new Date(b.placedAt)),
        }),
      ],
      [t("stage.factVintage"), formatVintage(b.year)],
      [t("stage.factKind"), tTypes(b.type)],
      [t("stage.factFormat"), t("stage.formatMl", { ml: b.formatMl })],
    ],
    [t, tTypes, when],
  );
  const canMove = writes && can?.move === true;
  const canTakeOut = writes && can?.takeOut === true;
  const actionsOf = useCallback(
    (b: SharedRackBottleView) => (
      <div className="flex flex-col gap-2">
        {canMove && (
          <Button
            variant="secondary"
            block
            data-testid="shared-rack-move"
            onClick={() => {
              handle.current?.dismiss();
              setMode({ kind: "move", bottle: b });
            }}
          >
            {t("stage.move")}
          </Button>
        )}
        {canTakeOut && (
          <Button
            variant="secondary"
            block
            data-testid="shared-rack-takeout"
            onClick={() => {
              handle.current?.dismiss();
              setTakenOut(null);
              setTakeOutFor(b);
            }}
          >
            {t("stage.takeOut")}
          </Button>
        )}
        <Button
          variant="ghost"
          block
          data-testid="shared-rack-bottle-history"
          onClick={() => {
            handle.current?.dismiss();
            setHistoryOf({ placementId: b.placementId, name: bottleName(b) });
            setSheet("activity");
          }}
        >
          {t("stage.history")}
        </Button>
      </div>
    ),
    [canMove, canTakeOut, t],
  );
  const rackName = rack?.name ?? "";
  const detailsOf = useCallback(
    (placed: PlacedBottle): InspectionDetails | null => {
      const b = byId.get(placed.id);
      if (!b) return null;
      return {
        // drawn from the wine's own names: a photo of a label never crosses households
        label: {
          producer: b.producer,
          name: b.wineName,
          year: b.year,
          place: placeLine(b.region, b.countryCode, locale),
          type: b.type,
          photoUrl: null,
          textured: false,
          backPhotoUrl: null,
        },
        title: b.wineName,
        subtitle: tSmart("subtitle", { producer: b.producer, year: formatVintage(b.year) }),
        facts: factsOf(b),
        where: t("stage.where", { rack: rackName, row: b.row, col: b.col }),
        actions: actionsOf(b),
      };
    },
    [byId, locale, tSmart, t, factsOf, actionsOf, rackName],
  );
  const labels: InspectionLabels = useMemo(
    () => ({
      close: tShowcase("putBack"),
      turn: tShowcase("spin"),
      how: {
        clear_path: tSmart("how.clear_path"),
        behind_bottle: tSmart("how.behind_bottle"),
        behind_door: tSmart("how.behind_door"),
        blocked: tSmart("how.blocked"),
        pile: tSmart("how.pile"),
        unknown_arrangement: tSmart("how.unknown_arrangement"),
      },
    }),
    [tSmart, tShowcase],
  );

  // No longer mine to see (removed, or left on another device): that is said, and NOTHING of the rack is shown, not
  // even what this screen still remembers of it.
  if (query.isError && refusalKind(query.error, RACK_NOT_FOUND_MESSAGE) === "gone")
    return (
      <div
        role="alert"
        data-testid="shared-rack-no-access"
        className="flex flex-col items-start gap-3 rounded-card border border-hairline bg-raised p-4"
      >
        <p className="font-medium text-ink">{t("stage.noAccessTitle")}</p>
        <p className="text-small text-ink-2">{t("stage.noAccessBody")}</p>
        <Button variant="secondary" onClick={onGone} data-testid="shared-rack-back">
          {t("stage.backToMine")}
        </Button>
      </div>
    );

  if (!rack || !resolved || !model) {
    if (query.isError && !query.isFetching)
      return (
        <div
          role="alert"
          data-testid="shared-rack-failed"
          className="flex flex-col items-start gap-2 rounded-card border border-hairline bg-raised p-4"
        >
          <p className="font-medium text-ink">{t("stage.loadFailedTitle")}</p>
          <p className="text-small text-ink-2">
            {isNotSetUp(query.error) ? t("notSetUp") : say(query.error)}
          </p>
          <div className="flex flex-wrap gap-2">
            {!isNotSetUp(query.error) && (
              <Button variant="secondary" onClick={() => void query.refetch()}>
                {tc("retry")}
              </Button>
            )}
            <Button variant="ghost" onClick={onGone}>
              {t("stage.backToMine")}
            </Button>
          </div>
        </div>
      );
    return <Skeleton className="h-[26rem]" />;
  }

  // the picture can point at a spot only where it has an exact place for it; otherwise the grid is where one is chosen
  const use3d =
    webgl && !lost && !flat && model.renderer !== "legacy" && !(offering && markers === null);
  const hidden = bottles.length - shown.length;

  return (
    <>
      <div
        className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2"
        data-testid="shared-rack-top"
      >
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate font-display text-title text-ink" data-testid="shared-rack-name">
            {rack.name}
          </h2>
          <p
            className="flex flex-wrap items-center gap-x-1.5 text-small text-ink-2"
            data-testid="shared-rack-meta"
          >
            <PeopleIcon size={16} className="shrink-0" />
            <span>
              {t("stage.shared")} · {t("members", { count: rack.memberCount })} ·{" "}
              {t("occupancy", { used: rack.occupied, capacity: rack.capacity })}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {writes && can?.place && !offering && (
            <Button
              size="md"
              onClick={() => setMode({ kind: "add" })}
              data-testid="shared-rack-add"
            >
              <PlusIcon size={18} />
              {t("stage.add")}
            </Button>
          )}
          <Button
            size="md"
            variant="secondary"
            onClick={() => {
              // who is in the rack may have changed since this screen read it (someone accepted, someone left)
              void membersQuery.refetch();
              setSheet("people");
            }}
            data-testid="shared-rack-people-open"
          >
            {t("stage.people")}
          </Button>
          <Button
            size="md"
            variant="secondary"
            onClick={() => {
              setHistoryOf(null);
              setSheet("activity");
            }}
            data-testid="shared-rack-activity-open"
          >
            {t("stage.activity")}
          </Button>
          {rack.role === "owner" && writes && (
            <Button
              size="md"
              variant="secondary"
              onClick={() => setSheet("settings")}
              data-testid="shared-rack-settings-open"
            >
              {t("stage.settings")}
            </Button>
          )}
          {webgl && !lost && model.renderer !== "legacy" && (
            <Button
              size="md"
              variant="ghost"
              onClick={() => setFlat((v) => !v)}
              data-testid="shared-rack-flat-toggle"
            >
              {flat ? t("stage.show3d") : t("stage.showList")}
            </Button>
          )}
        </div>
      </div>

      {rack.archived && (
        <p className="text-small text-ink-2" data-testid="shared-rack-archived">
          {t("stage.archivedNote")}
        </p>
      )}
      {!writes && list.data && <p className="text-small text-ink-2">{t("readOnly")}</p>}
      {query.isError && (
        <p role="status" className="text-small text-ink-2" data-testid="shared-rack-refresh-failed">
          {t("stage.refreshFailed")}
        </p>
      )}

      {offering ? (
        <div
          role="status"
          data-testid="shared-rack-choosing"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface p-3 ring-1 ring-hairline"
        >
          <span className="text-small text-ink">
            {free.length === 0
              ? t("stage.choosingNone")
              : mode.kind === "move"
                ? t("stage.choosingMove", { wine: bottleName(mode.bottle) })
                : t("stage.choosingAdd")}
            {free.length > 0 && (
              <span className="text-ink-2">
                {" "}
                · {t("stage.choosingFree", { count: free.length })}
              </span>
            )}
          </span>
          <Button
            size="md"
            variant="ghost"
            onClick={() => setMode({ kind: "view" })}
            data-testid="shared-rack-choosing-cancel"
          >
            {t("stage.choosingCancel")}
          </Button>
        </div>
      ) : (
        <>
          <div
            role="group"
            aria-label={t("stage.filterLabel")}
            className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0"
            data-testid="shared-rack-filter"
          >
            {choices.map((c) => (
              <Chip
                key={c.key}
                selected={c.key === active}
                onClick={() => setFilter(c.key)}
                className="h-11"
                data-owner={c.key}
              >
                {c.key === "all"
                  ? t("stage.filterAll", { count: c.count })
                  : c.key === "mine"
                    ? t("stage.filterMine", { count: c.count })
                    : t(c.former ? "stage.filterFormer" : "stage.filterPerson", {
                        name: c.name ?? t("someone"),
                        count: c.count,
                      })}
              </Chip>
            ))}
          </div>
          {/* always there, so nothing below jumps when a filter is chosen */}
          <p
            className="min-h-5 text-small text-ink-2"
            role="status"
            data-testid="shared-rack-filter-note"
          >
            {hidden > 0
              ? t("stage.filterHidden", { shown: shown.length, total: bottles.length })
              : ""}
          </p>
        </>
      )}

      {use3d ? (
        <>
          <div
            className="relative h-[clamp(20rem,calc((100vw-2.5rem)*var(--unit-ratio)+3rem),min(68vh,34rem))] sm:h-[min(68vh,34rem)]"
            style={{ "--unit-ratio": rack.rows / rack.cols } as CSSProperties}
          >
            <div
              role="group"
              aria-label={t("stage.canvasLabel", { rack: rack.name })}
              className="absolute inset-0 overflow-hidden rounded-card border border-hairline bg-raised shadow-raised"
              data-testid="shared-rack-stage"
              data-view="3d"
              data-bottles={bottles.length}
              data-shown={shown.length}
              data-mode={mode.kind}
              data-selected={selectedId ?? ""}
            >
              <InspectableStorage
                key={`${rack.id}:${attempt}`}
                handleRef={handle}
                model={model}
                bottles={stored}
                selectedId={selectedId && shownIds.has(selectedId) ? selectedId : null}
                onSelect={setSelectedId}
                detailsOf={detailsOf}
                labels={labels}
                panelSlot={panelSlot}
                reducedMotion={reduced}
                onLost={() => setLost(true)}
                debug={debug}
                spots={offering ? (markers ?? []) : null}
                onSpot={offering ? onSpot : undefined}
              />
              <p className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
                <span className="max-w-full rounded-full bg-surface/90 px-4 py-1.5 text-center text-caption text-ink-2 ring-1 ring-hairline">
                  {offering
                    ? t("stage.choosingAdd")
                    : bottles.length === 0
                      ? t("stage.empty")
                      : t("stage.hint")}
                </span>
              </p>
            </div>
          </div>
          <div ref={setPanelSlot} className="empty:hidden" data-testid="shared-rack-panel-slot" />
          {/* the same bottles for keyboard and screen-reader users; visible while one has focus */}
          {!offering && (
            <ul
              className="sr-only focus-within:not-sr-only focus-within:flex focus-within:flex-col focus-within:gap-1 focus-within:rounded-card focus-within:bg-raised focus-within:p-3"
              aria-label={t("stage.listLabel", { rack: rack.name })}
              data-testid="shared-rack-list"
            >
              {shown.map((b) => (
                <li key={b.placementId}>
                  <button type="button" onClick={() => handle.current?.inspect(b.placementId)}>
                    {t("stage.listBottle", {
                      wine: bottleName(b),
                      owner: b.mine ? t("you") : (b.owner.name ?? t("someone")),
                      row: b.row,
                      col: b.col,
                    })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div
          className="flex flex-col gap-3"
          data-testid="shared-rack-stage"
          data-view="grid"
          data-bottles={bottles.length}
          data-shown={shown.length}
          data-mode={mode.kind}
          data-selected={selectedId ?? ""}
        >
          {lost && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="shared-rack-lost"
            >
              <span className="text-small text-ink-2">{t3("lostBody")}</span>
              <Button
                size="md"
                variant="secondary"
                onClick={() => {
                  setLost(false);
                  setAttempt((n) => n + 1);
                }}
              >
                {t3("lostRetry")}
              </Button>
            </div>
          )}
          <RackGrid
            resolved={resolved}
            bottles={bottles}
            shown={shownIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            free={offering ? free : null}
            onSpot={onSpot}
            label={t("stage.gridLabel", { rack: rack.name })}
          />
          {bottles.length === 0 && !offering && (
            <p className="text-small text-ink-2" data-testid="shared-rack-empty">
              {t("stage.empty")}
            </p>
          )}
          {selected && !offering && (
            <section
              aria-label={t("stage.chosen")}
              data-testid="shared-rack-chosen"
              className="flex flex-col gap-3 rounded-card bg-surface p-4 ring-1 ring-hairline"
            >
              <div>
                <h3 className="font-display text-title text-ink">{selected.wineName}</h3>
                <p className="text-small text-ink-2">
                  {tSmart("subtitle", {
                    producer: selected.producer,
                    year: formatVintage(selected.year),
                  })}
                </p>
                <p className="text-small text-ink-2">
                  {t("stage.where", { rack: rack.name, row: selected.row, col: selected.col })}
                </p>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
                {factsOf(selected).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-2">{k}</dt>
                    <dd className="text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              {actionsOf(selected)}
            </section>
          )}
        </div>
      )}

      <AddBottleSheet
        open={addSpot !== null}
        spot={addSpot}
        busy={place.isPending}
        onChoose={doPlace}
        onClose={() => setAddSpot(null)}
      />
      <TakeOutSheet
        open={takeOutFor !== null}
        bottle={takeOutFor}
        rackName={rack.name}
        done={takenOut}
        busy={takeOut.isPending}
        onConfirm={doTakeOut}
        onClose={() => {
          setTakeOutFor(null);
          setTakenOut(null);
        }}
        onShowRacks={onShowRacks}
      />
      <PeopleSheet
        open={sheet === "people"}
        onClose={() => closeSheet("people")}
        rack={rack}
        members={members}
        writes={writes}
        onLeft={() => {
          setSheet(null);
          onGone();
        }}
      />
      <ActivitySheet
        open={sheet === "activity"}
        onClose={() => closeSheet("activity")}
        rack={rack}
        members={members}
        bottle={historyOf}
        onAllBottles={() => setHistoryOf(null)}
      />
      {rack.role === "owner" && (
        <SettingsSheet
          open={sheet === "settings"}
          onClose={() => closeSheet("settings")}
          rack={rack}
        />
      )}
    </>
  );
}
