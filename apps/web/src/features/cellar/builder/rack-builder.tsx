"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ERROR_MESSAGES,
  STORAGE_PALETTES,
  STORAGE_TEMPLATES,
  SMART_CELLAR_NOT_SET_UP,
  STALE_LAYOUT_MESSAGE,
  cellCapacitySavable,
  formatVintage,
  type SmartPlacementView,
  type SmartStorageUnitView,
  type StorageTemplateId,
  type StorageUnitView,
} from "@cellr/domain";
import { ApiError, api, errorMessage } from "@/lib/api";
import type { BuilderAccess } from "@/lib/smart-cellar-builder-gate";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { useReducedMotion, useWebGL } from "../cellar-3d-view";
import { useRefreshCellar } from "../hooks";
import {
  readPlacementsFresh,
  smartPlacementsKey,
  useSmartCapabilities,
  useSmartPlacements,
  useSmartUnits,
} from "../smart-cellar-hooks";
import { resolvedFromView, storedBottlesFrom } from "../storage3d/from-api";
import { LayoutMap } from "../storage3d/layout-map";
import { buildModel } from "../storage3d/model";
import {
  Choice,
  DimensionStepper,
  Section,
  Swatches,
  TemplateCatalogue,
  ZonesEditor,
} from "./builder-controls";
import {
  SIGNIFICANT,
  assess,
  changesBetween,
  chooseTemplate,
  dimensionRange,
  draftFromTemplate,
  draftFromUnit,
  isNewerRevision,
  parseDraft,
  rebaseDraft,
  resolvedOfDraft,
  savedAsDrafted,
  setColor,
  setDimension,
  setDoor,
  setLighting,
  setMaterial,
  setZoneCount,
  setZonePurpose,
  setZoneSplit,
  setZoneTemp,
  strandedBy,
  toConfig,
  type BuilderDraft,
  type ChangeKind,
  type Dimension,
  type Reconciled,
  type SaveProblem,
} from "./draft";
import { forgetDraft, recallDraft, rememberDraft } from "./draft-memory";

/**
 * THE RACK BUILDER (Smart Cellar 3D, sprint 3): design a place and see it, live, with the existing renderer.
 *
 * Only ever mounted by /cellar/builder (and /cellar/builder/:id), whose pages are "not found" unless the server's
 * builder gate is open (lib/smart-cellar-builder-gate.ts): nobody else downloads any of it. The picture is a lazy
 * module of its own, so three.js comes only with the picture.
 *
 * What is drawn is a DRAFT: nothing is written until Save, and Save is offered only where the server says saving is
 * possible here (`access.canSave`), the database has what saving needs, and the draft passes the domain's own rules.
 * A save of an existing place sends the revision the draft started from; a place changed meanwhile is not
 * overwritten (409). Bottles are never moved: a draft that would leave one without a spot cannot be saved.
 */
const BuilderPreview = dynamic(() => import("./builder-preview"), {
  ssr: false,
  loading: () => <StageNote testId="builder-preview-loading">…</StageNote>,
});

const DEBUG_FLAG = "cellr:3d-debug";
const readDebug = () => {
  try {
    return window.sessionStorage.getItem(DEBUG_FLAG) === "1";
  } catch {
    return false;
  }
};
const useDebug = () =>
  useSyncExternalStore(
    () => () => {},
    readDebug,
    () => false,
  );

function StageNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      className="grid h-full place-items-center p-6 text-center text-small text-ink-2"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** "Wine rack" if free, else "Wine rack 2", "Wine rack 3"… (the existing new-place sheet's rule). */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export interface RackBuilderProps {
  /** The place to edit, or null to make a new one. */
  placeId: string | null;
  access: BuilderAccess;
  /** Arrived here right after a successful save (the address said so). */
  justSaved?: boolean;
  /** Open at this section (from the cellar's "Edit zones", sprint 4). */
  section?: "zones" | null;
}

export function RackBuilder({
  placeId,
  access,
  justSaved = false,
  section = null,
}: RackBuilderProps) {
  const t = useTranslations("builder");
  const te = useTranslations();
  const caps = useSmartCapabilities(true);
  const place = useSmartPlacements(placeId);
  const units = useSmartUnits(placeId === null);
  const queryClient = useQueryClient();

  const failure = caps.error ?? (placeId ? place.error : null);
  if (failure) {
    const notSetUp =
      failure instanceof ApiError && failure.serverMessage === SMART_CELLAR_NOT_SET_UP;
    const notFound = failure instanceof ApiError && failure.code === "NOT_FOUND" && !notSetUp;
    return (
      <Frame>
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-card bg-surface p-5 ring-1 ring-hairline"
          data-testid="builder-failed"
        >
          <p className="text-ink">
            {notSetUp ? t("notSetUp") : notFound ? t("notFound") : t("loadFailed")}
          </p>
          {!notSetUp && !notFound && (
            <p className="text-small text-ink-2">
              {errorMessage(failure, (k) => te(k), ERROR_MESSAGES)}
            </p>
          )}
          {!notSetUp && !notFound && (
            <Button
              variant="secondary"
              onClick={() => {
                void caps.refetch();
                if (placeId) void place.refetch();
              }}
            >
              {t("retry")}
            </Button>
          )}
        </div>
      </Frame>
    );
  }
  if (caps.data?.schema.reads === "missing")
    return (
      <Frame>
        <p
          role="status"
          className="rounded-card bg-surface p-5 text-ink ring-1 ring-hairline"
          data-testid="builder-not-set-up"
        >
          {t("notSetUp")}
        </p>
      </Frame>
    );
  if (!caps.data || (placeId && !place.data) || (!placeId && !units.data))
    return (
      <Frame>
        <div className="grid gap-6 md:grid-cols-2" data-testid="builder-loading">
          <Skeleton className="h-[28rem]" />
          <Skeleton className="h-[28rem]" />
        </div>
      </Frame>
    );

  // saving needs all three: the server's gate (which already holds the database to be a test one), the API's
  // own word that it writes, and a database that has what saving uses
  const schemaBlocks = caps.data.schema.writes === "missing";
  const canSave = access.canSave && caps.data.writes && !schemaBlocks;
  const saveBlock = !access.canSave
    ? (access.saveBlockedBy ?? "setting")
    : !caps.data.writes
      ? "setting"
      : schemaBlocks
        ? "schema"
        : null;

  return (
    <BuilderEditor
      key={placeId ?? "new"}
      unit={place.data?.unit ?? null}
      placements={place.data?.placements ?? []}
      takenNames={new Set((units.data ?? []).map((u) => u.label.toLowerCase()))}
      canSave={canSave}
      saveBlock={saveBlock}
      justSaved={justSaved}
      section={section}
      reload={async () => (await readPlacementsFresh(queryClient, placeId!)).unit}
    />
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations("builder");
  return (
    <div className="flex flex-col gap-6 pt-4" data-testid="rack-builder">
      <Link href="/cellar" className="text-small text-ink-2 hover:text-ink">
        ← {t("back")}
      </Link>
      {children}
    </div>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirm"; changes: ChangeKind[] }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string; stale: boolean }
  | { kind: "nameFailed"; message: string };

function BuilderEditor({
  unit,
  placements,
  takenNames,
  canSave,
  saveBlock,
  justSaved,
  reload,
  section,
}: {
  section: "zones" | null;
  /**
   * Reads the place again from the server, now. Throws when that fails (no connection, signed out, an error): a
   * failure is never answered with the cached place.
   */
  reload: () => Promise<SmartStorageUnitView>;
  unit: SmartStorageUnitView | null;
  placements: readonly SmartPlacementView[];
  takenNames: ReadonlySet<string>;
  canSave: boolean;
  saveBlock: "setting" | "deployment" | "database" | "schema" | null;
  justSaved: boolean;
}) {
  const t = useTranslations("builder");
  const tt = useTranslations("storageTemplates");
  const tl = useTranslations("storageLook");
  const te = useTranslations();
  const router = useRouter();
  const refresh = useRefreshCellar();
  const queryClient = useQueryClient();
  const webgl = useWebGL();
  const reduced = useReducedMotion();
  const debug = useDebug();
  const mode: "new" | "edit" = unit ? "edit" : "new";
  const memoryKey = unit?.id ?? "new";

  // ---- the saved state and the draft ----
  const startFromSaved = (): BuilderDraft =>
    unit
      ? draftFromUnit(unit)
      : draftFromTemplate("rack_classic", uniqueName(tt("rack_classic.name"), takenNames));
  const [baseline, setBaseline] = useState(() => ({
    draft: startFromSaved(),
    revision: unit?.revision ?? null,
  }));
  // what the browser remembered of this place (a draft left with the back button, or a reload)
  const [recalled] = useState(() => {
    const memory = recallDraft(memoryKey);
    const draft = memory ? parseDraft(memory.draft) : null;
    if (!memory || !draft) return null;
    // a draft of an older version of the place is not laid over a version it never saw
    if (memory.revision !== null && memory.revision !== (unit?.revision ?? null)) return null;
    return { draft, partialCreate: memory.partialCreate ?? null };
  });
  const [draft, setDraft] = useState<BuilderDraft>(() => recalled?.draft ?? baseline.draft);
  const [restored, setRestored] = useState(recalled !== null && !recalled.partialCreate);
  const [partialCreate, setPartialCreate] = useState(recalled?.partialCreate ?? null);
  const [history, setHistory] = useState<BuilderDraft[]>([]);
  const [notes, setNotes] = useState<Reconciled[]>([]);
  const [nameTouched, setNameTouched] = useState(mode === "edit");
  const [phase, setPhase] = useState<Phase>(justSaved ? { kind: "saved" } : { kind: "idle" });
  const [discarding, setDiscarding] = useState<null | "reset" | "leave" | "restored">(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const changes = changesBetween(baseline.draft, draft);
  const dirty = changes.length > 0 || partialCreate !== null;

  // The place was changed elsewhere while it is open here (the query refreshes it). Nothing edited yet: take the
  // new version as it is. Edits in progress: keep them, and say that saving them is refused until reloaded.
  const [seenRevision, setSeenRevision] = useState(unit?.revision ?? null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  /** Starting again from the latest version: on its way, or failed (said, with a way to try again; nothing lost). */
  const [reloading, setReloading] = useState<null | "busy" | { failed: string; keepMine: boolean }>(
    null,
  );
  /**
   * After "keep my changes" (sprint 8): the person's changes now stand on the latest version, unsaved, and this says
   * what each side had changed. Cleared by the next save or a new start.
   */
  const [rebased, setRebased] = useState<null | {
    mine: ChangeKind[];
    theirs: ChangeKind[];
    both: ChangeKind[];
  }>(null);
  // only a LATER version is news: an answer that left before this screen's own save and arrives after it is older
  if (unit && isNewerRevision(unit.revision, seenRevision)) {
    setSeenRevision(unit.revision);
    if (isNewerRevision(unit.revision, baseline.revision)) {
      if (!dirty) {
        const fresh = draftFromUnit(unit);
        setBaseline({ draft: fresh, revision: unit.revision });
        setDraft(fresh);
        setChangedElsewhere(false);
        // while this screen is saving, the new revision is its own save landing: not someone else's change
      } else if (phase.kind !== "saving") setChangedElsewhere(true);
    }
  }

  // opened at a section (the cellar's "Edit zones"): that section is brought into view once
  useEffect(() => {
    if (section === "zones")
      document.getElementById("builder-zones")?.scrollIntoView({ block: "start" });
  }, [section]);

  // ---- memory, and leaving with unsaved changes ----
  useEffect(() => {
    if (dirty)
      rememberDraft(memoryKey, {
        draft,
        revision: partialCreate ? null : baseline.revision,
        partialCreate: partialCreate ?? undefined,
      });
    else forgetDraft(memoryKey);
  }, [dirty, draft, memoryKey, baseline.revision, partialCreate]);
  useEffect(() => {
    if (!dirty || phase.kind === "saving") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, phase.kind]);

  const apply = (next: BuilderDraft, reconciled: Reconciled[] = []) => {
    if (next === draft) return;
    setHistory((h) => [...h.slice(-49), draft]);
    setDraft(next);
    setNotes(reconciled);
    setRestored(false);
    if (phase.kind !== "saving") setPhase({ kind: "idle" });
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setDraft(last);
    setNotes([]);
    setPhase({ kind: "idle" });
  };
  const resetToSaved = () => {
    setRebased(null);
    setHistory([]);
    setDraft(baseline.draft);
    setNotes([]);
    setRestored(false);
    setPartialCreate(null);
    setPhase({ kind: "idle" });
    forgetDraft(memoryKey);
  };

  // ---- what the draft is ----
  const template = STORAGE_TEMPLATES[draft.template];
  const occupiedSpots = useMemo(
    () => placements.map((p) => ({ row: p.row, col: p.col, index: p.index, bottleId: p.bottleId })),
    [placements],
  );
  const current = unit
    ? {
        rows: unit.rows,
        cols: unit.cols,
        cellCapacity: unit.cellCapacity,
        semantics: unit.slotSemantics,
        capacity: unit.capacity,
      }
    : null;
  const assessment = assess(draft, current, occupiedSpots);
  const stranded = strandedBy(draft, placements);
  const previewOnly = assessment.problems.some((p) => p.kind === "preview_only");
  const status = assessment.savable ? "ready" : previewOnly ? "preview" : "blocked";

  // ---- the picture: the existing renderer, fed the draft (deferred, so the controls never wait for it) ----
  const shown = useDeferredValue(draft);
  const updating = shown !== draft;
  // a place whose stored template this app cannot read is shown as it is (neutral) until a template is chosen
  const neutral = unit !== null && !unit.legacy && !shown.templateChosen;
  const resolved = useMemo(
    () => (neutral && unit ? resolvedFromView(unit) : resolvedOfDraft(shown)),
    [neutral, unit, shown],
  );
  const model = useMemo(() => buildModel(resolved), [resolved]);
  const bottles = useMemo(() => storedBottlesFrom(placements), [placements]);
  const byId = useMemo(() => new Map(placements.map((p) => [p.bottleId, p])), [placements]);
  const picked = selected ? (byId.get(selected) ?? null) : null;
  const wine = (p: SmartPlacementView) => `${p.producer} ${p.wineName} ${formatVintage(p.year)}`;
  const mapBottles = useMemo(
    () =>
      placements.map((p) => ({
        id: p.bottleId,
        row: p.row,
        col: p.col,
        index: p.index,
        type: p.type,
        name: wine(p),
      })),
    [placements],
  );

  // ---- saving ----
  const reason = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);
  const layoutChanged = changes.some((c) => c !== "name") || partialCreate !== null;

  async function save() {
    setPhase({ kind: "saving" });
    const config = toConfig(draft);
    const label = draft.name.trim();
    if (!unit) {
      // 1. a basic place (the existing create), 2. its design (the existing layout save). Two calls, said so.
      let made: StorageUnitView;
      try {
        made = await api.post<StorageUnitView>("/storage", {
          label,
          kind: template.kind,
          rows: draft.rows,
          cols: draft.cols,
        });
      } catch (e) {
        setPhase({ kind: "failed", message: reason(e), stale: false });
        return;
      }
      forgetDraft("new");
      try {
        await api.put(`/smart-cellar/storage/${made.id}/layout`, config);
      } catch (e) {
        // The basic place exists. Its page opens with this draft and says so; saving there is an ordinary save,
        // so trying again never makes a second place, and nothing is deleted to hide what happened.
        rememberDraft(made.id, { draft, revision: null, partialCreate: { reason: reason(e) } });
        await refresh();
        router.replace(`/cellar/builder/${made.id}`);
        return;
      }
      await refresh();
      router.replace(`/cellar/builder/${made.id}?saved=1`);
      return;
    }
    // An answer to a refresh that left before this save must not land after it (it would be older than the save).
    await queryClient.cancelQueries({ queryKey: smartPlacementsKey(unit.id), exact: true });
    // The revision this save stands on, carried from one answer of the server to the next: never guessed, and
    // never taken from a refresh (which can fail, or be older).
    let revision = baseline.revision;
    let theirsLanded = false;
    if (layoutChanged) {
      try {
        const saved = await api.put<SmartStorageUnitView>(
          `/smart-cellar/storage/${unit.id}/layout`,
          config,
          partialCreate ? {} : { ifMatch: revision ?? undefined },
        );
        revision = saved.revision;
        // the server reads the place back after saving: if that is not what was saved, someone else's write landed
        // in between, and the revision is theirs
        theirsLanded = !savedAsDrafted(draft, saved);
      } catch (e) {
        const stale = e instanceof ApiError && e.serverMessage === STALE_LAYOUT_MESSAGE;
        setPhase({ kind: "failed", message: reason(e), stale });
        return;
      }
    }
    if (label !== unit.label && !theirsLanded) {
      try {
        // a rename made against the version this draft (or the save just made) stands on: refused when stale
        const renamed = await api.patch<{ revision: string }>(
          `/storage/${unit.id}`,
          { label },
          { ifMatch: revision ?? undefined },
        );
        revision = renamed.revision;
      } catch (e) {
        const stale = e instanceof ApiError && e.serverMessage === STALE_LAYOUT_MESSAGE;
        if (layoutChanged) {
          settleOn({ ...draft, name: unit.label }, revision);
          setPhase({ kind: "nameFailed", message: stale ? t("stale") : reason(e) });
        } else setPhase({ kind: "failed", message: reason(e), stale });
        await refresh().catch(() => undefined);
        return;
      }
    }
    setPartialCreate(null);
    if (theirsLanded) {
      // saved, but not the last word: say so, and keep the draft until the latest version is loaded
      settleOn(draft, revision);
      setChangedElsewhere(true);
      setPhase({ kind: "idle" });
    } else {
      settleOn(draft, revision);
      setPhase({ kind: "saved" });
    }
    forgetDraft(memoryKey);
    // the rest of the app sees the change; if this refresh fails, the revision above still stands (it came from
    // the save's own answers)
    await refresh().catch(() => undefined);
  }
  /** After a save: what was saved is the new starting point, at the revision the server answered with. */
  function settleOn(next: BuilderDraft, revision: string | null) {
    setRebased(null);
    setBaseline({ draft: { ...next, templateChosen: true }, revision });
    if (revision) setSeenRevision(revision);
    setHistory([]);
  }
  const requestSave = () => {
    const significant = mode === "edit" ? changes.filter((c) => SIGNIFICANT.includes(c)) : [];
    if (significant.length > 0 || (mode === "edit" && changes.includes("template")))
      setPhase({ kind: "confirm", changes });
    else void save();
  };
  /**
   * Starts again from the place as the server has it NOW (and its bottles: the read refreshes both). Nothing is dropped
   * until that read has succeeded: a failure (no connection, signed out, an error) is said with a way to try again,
   * and the draft, its history and the browser's memory of it stay exactly as they were.
   *
   * `keepMine` (sprint 8): the person's changes are carried over onto the latest version (rebaseDraft): each part
   * follows whoever changed it, and where both did, the person's. That is a DRAFT on the latest revision, unsaved: the
   * newer save is not overwritten by this, the draft is checked again against the bottles as they are now, and saving
   * it is the person's next step (with the latest revision, so a further save in between is refused again). Undo
   * goes back to the draft as it was. Without `keepMine`, the latest version replaces the draft, as before.
   */
  const loadLatest = async (keepMine = false) => {
    if (!unit) return;
    setReloading("busy");
    let latest: SmartStorageUnitView;
    try {
      latest = await reload();
    } catch (e) {
      setReloading({ failed: reason(e), keepMine });
      return;
    }
    const fresh = draftFromUnit(latest);
    if (keepMine) {
      const carried = rebaseDraft(draft, baseline.draft, fresh);
      setBaseline({ draft: fresh, revision: latest.revision });
      setSeenRevision(latest.revision);
      setHistory((h) => [...h.slice(-49), draft]);
      setDraft(carried.draft);
      setRebased({ mine: carried.mine, theirs: carried.theirs, both: carried.both });
    } else {
      forgetDraft(memoryKey);
      setBaseline({ draft: fresh, revision: latest.revision });
      setSeenRevision(latest.revision);
      setDraft(fresh);
      setHistory([]);
      setRebased(null);
    }
    setNotes([]);
    setRestored(false);
    setChangedElsewhere(false);
    setPhase({ kind: "idle" });
    setReloading(null);
  };
  const kinds = (list: readonly ChangeKind[]) =>
    list.map((k) => t(`conflict.kinds.${k}`)).join(", ");

  // ---- labels ----
  const dimLabel = (field: Dimension) => {
    if (field === "cellCapacity")
      return template.family === "bins" ? t("cellCapacityBins") : t("cellCapacity");
    if (template.id === "wall_rails") return field === "rows" ? t("rowsRails") : t("colsRails");
    if (template.family === "bins") return field === "rows" ? t("rowsBins") : t("colsBins");
    if (template.family === "wall") return field === "rows" ? t("rowsWall") : t("colsWall");
    return field === "rows" ? t("rows") : t("cols");
  };
  const problemText = (p: SaveProblem) =>
    p.kind === "layout"
      ? t(`problems.${p.problem}`)
      : p.kind === "preview_only"
        ? t(p.templateNeedsDepth ? "problems.preview_only_template" : "problems.preview_only")
        : t(`problems.${p.kind}`);
  const templateName = (id: StorageTemplateId) => tt(`${id}.name`);
  const title = unit ? t("titleEdit", { name: unit.label }) : t("titleNew");
  const placeName = draft.name.trim() || templateName(draft.template);

  // ---- the screen ----
  return (
    <div
      className="flex flex-col gap-6 pt-4"
      data-testid="rack-builder"
      data-mode={mode}
      data-template={draft.template}
      data-dirty={dirty}
      data-status={status}
      data-can-save={canSave}
    >
      <header className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => (dirty ? setDiscarding("leave") : router.push("/cellar"))}
          className="self-start text-small text-ink-2 hover:text-ink"
          data-testid="builder-back"
        >
          ← {t("back")}
        </button>
        <h1 className="font-display text-display text-ink">{title}</h1>
        <p className="text-ink-2">{t("intro")}</p>
      </header>

      {!canSave && saveBlock && (
        <p
          role="note"
          className="rounded-card bg-raised p-4 text-small text-ink"
          data-testid="builder-preview-only"
          data-reason={saveBlock}
        >
          <strong className="block font-medium">{t("previewOnlyMode")}</strong>
          {t(`previewOnlyWhy.${saveBlock}`)}
        </p>
      )}
      {partialCreate && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-danger/40"
          data-testid="builder-partial-create"
        >
          <p className="text-ink">
            {t("partialCreate", { name: unit?.label ?? placeName, reason: partialCreate.reason })}
          </p>
          <p className="text-small text-ink-2">{t("partialCreateHelp")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDiscarding("reset")}
              data-testid="builder-keep-basic"
            >
              {t("keepBasic")}
            </Button>
          </div>
        </div>
      )}
      {restored && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-raised p-3 text-small"
          data-testid="builder-restored"
        >
          <span>{t("restored")}</span>
          <Button variant="ghost" size="sm" onClick={() => setDiscarding("restored")}>
            {t("discardRestored")}
          </Button>
        </div>
      )}
      {changedElsewhere && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface p-3 text-small ring-1 ring-hairline"
          data-testid="builder-changed-elsewhere"
        >
          <span>{t("stale")}</span>
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={reloading === "busy"}
              onClick={() => void loadLatest(true)}
              data-testid="builder-keep-mine"
            >
              {t("conflict.keepMine")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={reloading === "busy"}
              onClick={() => void loadLatest()}
            >
              {t("loadLatest")}
            </Button>
          </span>
        </div>
      )}
      {rebased && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-card bg-raised p-3 text-small"
          data-testid="builder-rebased"
          data-theirs={rebased.theirs.join(" ")}
          data-mine={rebased.mine.join(" ")}
          data-both={rebased.both.join(" ")}
        >
          <strong className="font-medium text-ink">{t("conflict.rebased")}</strong>
          {rebased.theirs.length > 0 && (
            <span>{t("conflict.theirs", { list: kinds(rebased.theirs) })}</span>
          )}
          {rebased.mine.length > 0 && (
            <span>{t("conflict.mine", { list: kinds(rebased.mine) })}</span>
          )}
          {rebased.both.length > 0 && (
            <span>{t("conflict.both", { list: kinds(rebased.both) })}</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-10">
        {/* the picture first on a phone (sticky, so every change is seen without scrolling back), right on a desktop */}
        <div className="sticky top-0 z-10 -mx-5 min-w-0 bg-canvas px-5 pb-3 pt-safe md:static md:order-2 md:mx-0 md:self-stretch md:px-0 md:pt-0">
          <div className="md:sticky md:top-6">
            <div
              className="relative h-[34dvh] min-h-[14rem] overflow-hidden rounded-card border border-hairline bg-[radial-gradient(120%_90%_at_50%_15%,#f7f1e8_0%,#e9e0d3_70%,#ddd2c3_100%)] md:h-[min(68vh,40rem)]"
              role="group"
              aria-label={t("preview.label", { name: placeName })}
              data-testid="builder-stage"
              data-template={neutral ? "" : shown.template}
              data-rows={shown.rows}
              data-cols={shown.cols}
              data-cell-capacity={shown.cellCapacity}
              data-material={shown.appearance.material}
              data-color={shown.appearance.color}
              data-lighting={shown.appearance.lighting}
              data-door={shown.appearance.door}
              data-zones={shown.zones.length}
              data-bottles={placements.length}
              data-stranded={stranded.length}
              data-updating={updating}
              data-neutral={neutral}
            >
              {!webgl ? (
                <div
                  className="flex h-full flex-col gap-2 overflow-auto p-3"
                  data-testid="builder-flat"
                >
                  <p className="text-small text-ink-2">{t("preview.noWebgl")}</p>
                  <LayoutMap resolved={resolved} bottles={mapBottles} label={placeName} />
                </div>
              ) : lost ? (
                <div
                  className="grid h-full place-items-center p-6 text-center"
                  data-testid="builder-lost"
                >
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-ink">{t("preview.lost")}</p>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setLost(false);
                        setAttempt((a) => a + 1);
                      }}
                    >
                      {t("preview.restart")}
                    </Button>
                  </div>
                </div>
              ) : (
                <BuilderPreview
                  key={attempt}
                  model={model}
                  bottles={bottles}
                  selectedId={selected}
                  onPick={setSelected}
                  reducedMotion={reduced}
                  onLost={() => setLost(true)}
                  debug={debug}
                />
              )}
              <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-surface/90 px-3 py-1 text-caption font-medium text-ink shadow-raised">
                  {neutral
                    ? t("preview.neutral")
                    : `${templateName(shown.template)} · ${shown.rows} × ${shown.cols}`}
                </span>
                {updating && (
                  <span
                    className="rounded-full bg-surface/90 px-3 py-1 text-caption text-ink-2"
                    data-testid="builder-updating"
                  >
                    {t("preview.updating")}
                  </span>
                )}
              </div>
              {webgl && !lost && (
                <p className="pointer-events-none absolute inset-x-0 bottom-2 hidden text-center text-caption text-ink-2 sm:block">
                  {t("preview.hint")}
                </p>
              )}
            </div>
            <div
              className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-small"
              data-testid="builder-summary"
            >
              <span className="font-medium text-ink">
                {t("capacity", { count: assessment.capacity })}
              </span>
              {unit && (
                <span className="text-ink-2">{t("occupied", { count: assessment.occupied })}</span>
              )}
              <span className="text-ink-2">{t("free", { count: assessment.free })}</span>
              {unit && (
                <span
                  className="text-ink-2"
                  data-testid="builder-delta"
                  data-delta={assessment.delta}
                >
                  {t("delta", {
                    delta: assessment.delta,
                    signed:
                      assessment.delta > 0 ? `+${assessment.delta}` : String(assessment.delta),
                  })}
                </span>
              )}
            </div>
            {picked && (
              <p className="mt-1 text-small text-ink-2" data-testid="builder-picked">
                {t("preview.chosen", { wine: wine(picked), row: picked.row, col: picked.col })}
              </p>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-8 md:order-1">
          <div className="-ml-3 flex flex-wrap gap-1" data-testid="builder-tools">
            <Button
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={history.length === 0}
              data-testid="builder-undo"
            >
              {t("undo")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDiscarding("reset")}
              disabled={!dirty}
              data-testid="builder-reset"
            >
              {t("reset")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="builder-defaults"
              onClick={() => apply({ ...draftFromTemplate(draft.template, draft.name) })}
            >
              {t("restoreDefaults")}
            </Button>
          </div>

          {unit?.legacy && !draft.templateChosen && (
            <p
              className="rounded-card bg-raised p-4 text-small text-ink"
              data-testid="builder-suggested"
            >
              {t("preview.suggested", { template: templateName(draft.template) })}
            </p>
          )}
          {neutral && (
            <p
              className="rounded-card bg-raised p-4 text-small text-ink"
              data-testid="builder-unknown"
            >
              {t("preview.neutral")}
            </p>
          )}
          {unit && placements.length > 0 && (
            <p className="text-small text-ink-2">
              {t("preview.realBottles", { count: placements.length })}
            </p>
          )}

          <Section title={t("sections.template")} id="builder-template">
            <TemplateCatalogue
              value={draft.template}
              chosen={draft.templateChosen}
              onChoose={(id) => {
                const change = chooseTemplate(draft, id, mode);
                const next = change.draft;
                // the suggested name follows the template until the person names the place
                apply(
                  mode === "new" && !nameTouched
                    ? { ...next, name: uniqueName(templateName(id), takenNames) }
                    : { ...next, name: draft.name },
                  change.reconciled,
                );
              }}
            />
          </Section>

          <Section title={t("sections.name")} id="builder-name">
            <Field
              label={t("nameLabel")}
              hideLabel
              placeholder={t("namePlaceholder")}
              autoComplete="off"
              maxLength={60}
              value={draft.name}
              data-testid="builder-name"
              error={
                assessment.problems.some((p) => p.kind === "name") && draft.name.length > 0
                  ? t("nameProblem")
                  : null
              }
              onChange={(e) => {
                setNameTouched(true);
                apply({ ...draft, name: e.target.value });
              }}
            />
          </Section>

          <Section title={t("sections.size")} id="builder-size">
            {(["rows", "cols", "cellCapacity"] as const).map((field) => {
              const range = dimensionRange(draft, field);
              if (field === "cellCapacity" && template.cellCapacity.max === 1) return null;
              return (
                <DimensionStepper
                  key={field}
                  label={dimLabel(field)}
                  value={draft[field]}
                  min={range.min}
                  max={range.max}
                  testId={`builder-${field}`}
                  onChange={(v) => {
                    const change = setDimension(draft, field, v);
                    apply(change.draft, change.reconciled);
                  }}
                  note={
                    field === "cellCapacity" && !cellCapacitySavable(draft.cellCapacity) ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-caption text-ink-2">
                        <span>{t("cellCapacityPreview")}</span>
                        {range.min <= 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid="builder-use-one"
                            onClick={() => apply(setDimension(draft, "cellCapacity", 1).draft)}
                          >
                            {t("useOne")}
                          </Button>
                        )}
                      </div>
                    ) : undefined
                  }
                />
              );
            })}
          </Section>

          <Section title={t("sections.look")} id="builder-look">
            <Choice
              label={t("material")}
              options={template.appearance.materials}
              value={draft.appearance.material}
              name={(m) => tl(`material.${m}`)}
              testId="builder-material"
              onChange={(m) => {
                const change = setMaterial(draft, m);
                apply(change.draft, change.reconciled);
              }}
            />
            <Swatches
              label={t("color")}
              colors={STORAGE_PALETTES[draft.appearance.material]}
              value={draft.appearance.color}
              name={(c) => tl(`color.${c}`)}
              onChange={(c) => apply(setColor(draft, c))}
            />
            <Choice
              label={t("lighting")}
              options={template.appearance.lighting}
              value={draft.appearance.lighting}
              name={(l) => tl(`lighting.${l}`)}
              testId="builder-lighting"
              onChange={(l) => apply(setLighting(draft, l))}
            />
            <Choice
              label={t("door")}
              options={template.appearance.doors}
              value={draft.appearance.door}
              name={(d) => tl(`door.${d}`)}
              testId="builder-door"
              onChange={(d) => apply(setDoor(draft, d))}
            />
          </Section>

          {template.zones && (
            <Section title={t("sections.zones")} id="builder-zones">
              <ZonesEditor
                template={draft.template}
                rows={draft.rows}
                zones={draft.zones}
                onCount={(n) => apply(setZoneCount(draft, n))}
                onSplit={(n) => apply(setZoneSplit(draft, n))}
                onPurpose={(i, p) => apply(setZonePurpose(draft, i, p))}
                onTemp={(i, v) => apply(setZoneTemp(draft, i, v))}
              />
            </Section>
          )}

          {notes.length > 0 && (
            <ul
              role="status"
              className="flex flex-col gap-1 text-small text-ink-2"
              data-testid="builder-reconciled"
            >
              {notes.map((n) => (
                <li key={n}>{t(`reconciled.${n}`)}</li>
              ))}
            </ul>
          )}

          {stranded.length > 0 && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-danger/40"
              data-testid="builder-blockers"
            >
              <p className="font-medium text-ink">
                {t("blockers.title", { count: stranded.length })}
              </p>
              <p className="text-small text-ink-2">
                {t("blockers.body", { count: stranded.length })}
              </p>
              <ul className="flex flex-col gap-1 text-small text-ink">
                {stranded.slice(0, 12).map((p) => (
                  <li key={p.bottleId} data-bottle={p.bottleId}>
                    {t("blockers.item", { wine: wine(p), row: p.row, col: p.col })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* the save bar: always reachable, above the phone's bottom navigation and its safe area */}
      <div
        className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-20 lg:bottom-6"
        data-testid="builder-savebar"
      >
        {/* one row on a wide screen (status, actions, Save; messages below), stacked on a phone */}
        <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-surface/95 px-4 py-3 shadow-raised ring-1 ring-hairline backdrop-blur-xl md:gap-x-4">
          <div className="order-1 flex min-w-0 flex-1 items-center gap-2">
            <span className="flex items-center gap-2 text-small">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 rounded-full",
                  status === "ready"
                    ? "bg-[#3f7d4e]"
                    : status === "preview"
                      ? "bg-[#b07a2a]"
                      : "bg-danger",
                )}
              />
              <span className="font-medium text-ink" data-testid="builder-status">
                {phase.kind === "saved" && !dirty
                  ? t("saved")
                  : dirty
                    ? t("unsaved")
                    : t("noChanges")}
                {" · "}
                {t(`status.${status}`)}
              </span>
            </span>
          </div>
          {!assessment.savable && (
            <ul
              className="flex flex-col gap-0.5 text-small text-ink-2 order-3 basis-full"
              data-testid="builder-problems"
            >
              {assessment.problems.map((p, i) => (
                <li
                  key={i}
                  data-problem={p.kind === "layout" ? p.problem : p.kind}
                  // a phone shows the first reason; a wide screen all of them
                  className={i > 0 ? "hidden md:list-item" : undefined}
                >
                  {problemText(p)}
                </li>
              ))}
            </ul>
          )}
          {phase.kind === "failed" && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 text-small text-danger order-3 basis-full"
              data-testid="builder-save-failed"
              data-stale={phase.stale}
            >
              <span>{phase.stale ? t("stale") : t("saveFailed", { reason: phase.message })}</span>
              {phase.stale && (
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={reloading === "busy"}
                    onClick={() => void loadLatest(true)}
                    data-testid="builder-keep-mine"
                  >
                    {t("conflict.keepMine")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={reloading === "busy"}
                    onClick={() => void loadLatest()}
                  >
                    {t("loadLatest")}
                  </Button>
                </span>
              )}
            </div>
          )}
          {reloading !== null && reloading !== "busy" && (
            <div
              role="alert"
              className="order-3 flex basis-full flex-wrap items-center justify-between gap-2 text-small text-danger"
              data-testid="builder-reload-failed"
            >
              <span>{t("reloadFailed", { reason: reloading.failed })}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadLatest(reloading.keepMine)}
              >
                {t("retry")}
              </Button>
            </div>
          )}
          {phase.kind === "nameFailed" && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 text-small text-danger order-3 basis-full"
              data-testid="builder-name-failed"
            >
              <span>{t("partialName", { reason: phase.message })}</span>
              <Button variant="secondary" size="sm" onClick={() => void save()}>
                {t("retryName")}
              </Button>
            </div>
          )}
          {phase.kind === "saved" && !dirty && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 order-3 basis-full"
              data-testid="builder-saved"
            >
              <span className="text-small text-ink">
                <strong className="font-medium">
                  {t("savedTitle", { name: unit?.label ?? placeName })}
                </strong>{" "}
                {t("savedBody")}
              </span>
              <Link
                href="/cellar"
                className={buttonStyles({ variant: "secondary", size: "sm" })}
                data-testid="builder-see-in-cellar"
              >
                {t("seeInCellar")}
              </Link>
            </div>
          )}
          {canSave && (
            <Button
              disabled={!assessment.savable || (!dirty && mode === "edit") || changedElsewhere}
              loading={phase.kind === "saving"}
              onClick={requestSave}
              data-testid="builder-save"
              className="order-2 w-auto min-w-28 md:min-w-48"
            >
              {phase.kind === "saving" ? t("saving") : mode === "new" ? t("create") : t("save")}
            </Button>
          )}
        </div>
      </div>

      <Sheet
        open={phase.kind === "confirm"}
        onClose={() => setPhase({ kind: "idle" })}
        title={t("confirmTitle")}
        description={t("confirmBody", { name: unit?.label ?? placeName })}
      >
        {phase.kind === "confirm" && (
          <div className="flex flex-col gap-4" data-testid="builder-confirm">
            <ul className="flex flex-col gap-1 text-small text-ink">
              {phase.changes.map((c) => (
                <li key={c}>
                  {c === "template"
                    ? t("confirmChanges.template", {
                        from: baseline.draft.templateChosen
                          ? templateName(baseline.draft.template)
                          : "—",
                        to: templateName(draft.template),
                      })
                    : c === "size"
                      ? t("confirmChanges.size", {
                          fromRows: baseline.draft.rows,
                          fromCols: baseline.draft.cols,
                          toRows: draft.rows,
                          toCols: draft.cols,
                        })
                      : c === "cellCapacity"
                        ? t("confirmChanges.cellCapacity", {
                            from: baseline.draft.cellCapacity,
                            to: draft.cellCapacity,
                          })
                        : c === "name"
                          ? t("confirmChanges.name", {
                              from: baseline.draft.name,
                              to: draft.name.trim(),
                            })
                          : t(`confirmChanges.${c}`)}
                </li>
              ))}
            </ul>
            <Button size="lg" block onClick={() => void save()} data-testid="builder-confirm-save">
              {t("confirmSave")}
            </Button>
            <Button variant="ghost" size="lg" block onClick={() => setPhase({ kind: "idle" })}>
              {t("cancel")}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={discarding !== null}
        onClose={() => setDiscarding(null)}
        title={t("discardTitle")}
        description={t("discardBody")}
      >
        <div className="flex flex-col gap-3" data-testid="builder-discard">
          <Button
            variant="danger"
            size="lg"
            block
            data-testid="builder-discard-confirm"
            onClick={() => {
              const why = discarding;
              setDiscarding(null);
              resetToSaved();
              if (why === "leave") router.push("/cellar");
            }}
          >
            {t("discard")}
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => setDiscarding(null)}>
            {t("keepEditing")}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
