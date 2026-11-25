"use client";

import type { FreeSpot, SpotMarker } from "../quick-add/spots";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/ui/cn";
import { CloseIcon } from "@/ui/icons";
import type { LabelSpec } from "../three/label-texture";
import {
  placeBottles,
  type PlacedBottle,
  type Quality,
  type RenderModel,
  type StoredBottle,
} from "./model";
import { layoutForWidth, type InspectionLayout } from "./showcase-film";
import {
  SHOWCASE_IDLE,
  isOut,
  showcaseReducer,
  type ShowcaseEvent,
  type ShowcaseState,
} from "./showcase-machine";
import { planExtraction, type ExtractionPlan, type ExtractionReason } from "./showcase-plan";
import TemplateScene from "./template-scene";

/**
 * A place in 3D whose bottles can be taken out to be looked at (Smart Cellar 3D, sprint 2B.1): the storage view,
 * the picture of the place that stands in behind a bottle that is out, and the panel with what the bottle is.
 *
 * It holds the inspection's state (showcase-machine.ts) and everything around the 3D view that a person touches:
 * a tap on a bottle takes it out; a tap beside it, the close button or Escape puts it back; the panel takes the
 * focus when the bottle has arrived and gives it back when the bottle is home. It decides nothing about HOW a
 * bottle leaves its place (showcase-plan.ts) and animates nothing (showcase-hero.tsx).
 *
 * What a bottle IS (its wine, its label) is the caller's: `detailsOf`. Nothing is fetched here.
 */
export interface InspectionDetails {
  /** What is printed on the bottle. */
  label: LabelSpec;
  title: string;
  subtitle: string;
  facts: ReadonlyArray<readonly [name: string, value: string]>;
  /** Where the bottle is kept, in words that claim no more than is known. */
  where: string;
  /**
   * What can be done from here, above "put it back": real links and buttons of the screen that mounts the view
   * (the way to the wine's own page). Nothing is drawn when there is none.
   */
  actions?: ReactNode;
}

/** The words of the panel. English here; a product screen passes its own. */
export interface InspectionLabels {
  close: string;
  turn: string;
  /** How the bottle left its place, said plainly: drawn out, or only shown. */
  how: Record<ExtractionReason, string>;
}

export const INSPECTION_LABELS_EN: InspectionLabels = {
  close: "Put it back",
  turn: "Drag the bottle to turn it.",
  how: {
    clear_path: "Taken out of its place.",
    behind_bottle: "Shown without drawing it out: another bottle lies in front of it.",
    behind_door: "Shown without drawing it out: the door in front of it stays closed.",
    blocked: "Shown without drawing it out: its shelf holds it in.",
    pile: "Lifted out of the picture of its pile. Where it lies in the pile is not recorded.",
    unknown_arrangement:
      "Shown, not taken from a spot: CELLR does not know how this place is arranged.",
  },
};

export interface InspectableStorageProps {
  model: RenderModel;
  bottles: readonly StoredBottle[];
  quality?: Quality | undefined;
  selectedId?: string | null | undefined;
  /** A bottle was chosen (or none): taking one out chooses it, and it stays chosen when it is back. */
  onSelect?: ((id: string | null) => void) | undefined;
  detailsOf: (bottle: PlacedBottle) => InspectionDetails | null;
  /** A bottle to take out as soon as the view is up (a link to "this bottle, out"). */
  initialInspect?: string | undefined;
  /** Where the panel goes when it does not fit beside the bottle: an element below the picture. */
  panelSlot?: HTMLElement | null | undefined;
  /** A status bar or a notch over the top of the picture, in px. */
  safeTop?: number | undefined;
  reducedMotion?: boolean | undefined;
  onLost?: (() => void) | undefined;
  /** Told where the inspection stands, whenever that changes. */
  onState?: ((state: ShowcaseState, plan: ExtractionPlan | null) => void) | undefined;
  debug?: boolean | undefined;
  labels?: InspectionLabels | undefined;
  className?: string | undefined;
  /** A spot a bottle is about to be put on: marked in the picture (sprint 4). */
  target?: { row: number; col: number; index: number } | null | undefined;
  /** Free spots to tap (3D Quick Add, sprint 7): while given, a tap chooses a spot and takes no bottle out. */
  spots?: readonly SpotMarker[] | null | undefined;
  onSpot?: ((spot: FreeSpot) => void) | undefined;
}

export interface InspectableStorageHandle {
  /** Take a bottle out (refused while another is out or moving). */
  inspect: (id: string) => void;
  dismiss: () => void;
}

export default function InspectableStorage({
  model,
  bottles,
  quality,
  selectedId = null,
  onSelect,
  detailsOf,
  initialInspect,
  panelSlot,
  safeTop = 0,
  reducedMotion = false,
  onLost,
  onState,
  debug = false,
  labels = INSPECTION_LABELS_EN,
  className,
  target = null,
  spots = null,
  onSpot,
  handleRef,
}: InspectableStorageProps & {
  handleRef?: React.RefObject<InspectableStorageHandle | null> | undefined;
}) {
  // The machine's state, twice: in a ref, so that events are judged against what is true NOW (several taps can
  // arrive before the next render), and in React state, for drawing. `send` says whether the event was taken.
  const [state, setState] = useState<ShowcaseState>(SHOWCASE_IDLE);
  const current = useRef<ShowcaseState>(SHOWCASE_IDLE);
  const send = useCallback((event: ShowcaseEvent): boolean => {
    const before = current.current;
    const next = showcaseReducer(before, event);
    if (next === before) return false;
    current.current = next;
    setState(next);
    return true;
  }, []);
  const placement = useMemo(() => placeBottles(model, bottles), [model, bottles]);
  // the place changed under a bottle that is out: there is no movement to finish, the inspection is simply over
  // (before the next picture is drawn: a layout effect)
  useLayoutEffect(() => {
    send({ type: "cancel" });
  }, [placement, send]);

  const stage = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);

  const out = isOut(state);
  const bottle = out ? (placement.placed.find((b) => b.id === state.bottleId) ?? null) : null;
  const plan = useMemo(
    () => (bottle ? planExtraction(model, bottle, placement.placed) : null),
    [model, bottle, placement],
  );
  const details = useMemo(() => (bottle ? detailsOf(bottle) : null), [bottle, detailsOf]);

  // ---- the picture's width decides where the panel goes ---------------------------------------------------------
  const [layout, setLayout] = useState<InspectionLayout>("side");
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    // no place given for the panel outside a narrow picture: it becomes a sheet inside it, never nothing
    const hasSlot = panelSlot !== null && panelSlot !== undefined;
    const measure = () => setLayout(layoutForWidth(el.clientWidth, hasSlot));
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [panelSlot]);

  // ---- asking for a bottle, and letting it go ---------------------------------------------------------------------
  const inspect = useCallback(
    (id: string) => {
      const from = current.current.phase;
      // refused while another bottle is out or moving: nothing is chosen, marked or remembered for it then
      if (!send({ type: "open", bottleId: id })) return;
      if (from === "idle") {
        opener.current = document.activeElement;
        performance.mark("cellr:inspect-open");
      }
      // the bottle that is taken out is the chosen bottle, and stays chosen when it is back
      onSelect?.(id);
    },
    [send, onSelect],
  );
  const dismiss = useCallback(() => send({ type: "dismiss" }), [send]);
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { inspect, dismiss };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, inspect, dismiss]);

  const onArrived = useCallback((run: number) => send({ type: "arrived", run }), [send]);
  const onReturned = useCallback((run: number) => send({ type: "returned", run }), [send]);
  const onGone = useCallback(() => send({ type: "cancel" }), [send]);
  const lost = useCallback(() => {
    send({ type: "cancel" });
    onLost?.();
  }, [send, onLost]);

  // a link to "this bottle, out": once, when the view is up
  const asked = useRef(false);
  const onReady = useCallback(() => {
    if (asked.current || !initialInspect || spots !== null) return;
    asked.current = true;
    inspect(initialInspect);
  }, [initialInspect, inspect, spots]);

  // ---- keys and focus ---------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!out) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [out, dismiss]);

  const was = useRef(state.phase);
  useEffect(() => {
    const before = was.current;
    was.current = state.phase;
    // arrived: what the bottle is can be read, so the panel takes the focus (without scrolling the page under a thumb)
    if (state.phase === "inspecting") panel.current?.focus({ preventScroll: true });
    // home: the focus goes back to where it came from, or to the picture
    if (state.phase === "idle" && before !== "idle") {
      const back = opener.current;
      opener.current = null;
      // ...unless the person has gone on meanwhile (a button in the panel opened something else that took the focus):
      // the focus is not pulled back from where they are now
      const active = document.activeElement;
      const withUs =
        !active ||
        active === document.body ||
        panel.current?.contains(active) === true ||
        stage.current?.contains(active) === true;
      if (!withUs) return;
      if (back instanceof HTMLElement && back.isConnected && back !== document.body)
        back.focus({ preventScroll: true });
      else stage.current?.focus({ preventScroll: true });
    }
  }, [state.phase]);

  useEffect(() => {
    onState?.(state, plan);
  }, [state, plan, onState]);

  const pick = useCallback(
    (id: string | null) => {
      if (id === null) onSelect?.(null);
      else inspect(id);
    },
    [onSelect, inspect],
  );

  const open = state.phase === "extracting" || state.phase === "inspecting";
  const stacked = layout === "stacked" && panelSlot != null;
  const details_ = (
    <InspectionPanel
      ref={panel}
      open={open}
      place={stacked ? "below" : layout === "side" ? "beside" : "sheet"}
      details={details}
      how={plan ? labels.how[plan.reason] : null}
      labels={labels}
      onClose={dismiss}
    />
  );

  return (
    <div
      ref={stage}
      tabIndex={-1}
      className={cn("relative h-full w-full outline-none", className)}
      data-testid="inspectable-storage"
      data-showcase={state.phase}
      data-showcase-bottle={state.bottleId ?? undefined}
      data-showcase-mode={plan?.mode}
      data-showcase-reason={plan?.reason}
      data-layout={layout}
    >
      {/* the picture of the place that stands in for it while a bottle is looked at (put there by the 3D view) */}
      <div
        ref={backdrop}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        data-testid="storage-still"
      />
      <TemplateScene
        model={model}
        bottles={bottles}
        placement={placement}
        quality={quality}
        selectedId={selectedId}
        onPick={pick}
        reducedMotion={reducedMotion}
        onReady={onReady}
        onLost={lost}
        debug={debug}
        target={target}
        spots={spots}
        onSpot={onSpot}
        inspection={{
          state,
          label: details?.label ?? null,
          layout,
          safeTop,
          backdrop,
          onArrived,
          onReturned,
          onDismiss: dismiss,
          onGone,
        }}
      />
      {out && (
        <button
          type="button"
          onClick={dismiss}
          aria-label={labels.close}
          data-testid="inspection-close"
          className="absolute left-3 top-3 z-20 grid size-11 place-items-center rounded-full bg-surface/90 text-ink shadow-raised ring-1 ring-hairline backdrop-blur transition-opacity duration-200 ease-cellr hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg"
        >
          <CloseIcon className="size-5" />
        </button>
      )}
      {stacked && panelSlot ? createPortal(details_, panelSlot) : details_}
    </div>
  );
}

/**
 * What the bottle that is out is: beside it on a wide picture, below the picture on a narrow one, or (when the
 * screen gave no place below it) a sheet over the lower part of the picture.
 */
function InspectionPanel({
  ref,
  open,
  place,
  details,
  how,
  labels,
  onClose,
}: {
  ref: React.RefObject<HTMLElement | null>;
  open: boolean;
  place: "beside" | "below" | "sheet";
  details: InspectionDetails | null;
  how: string | null;
  labels: InspectionLabels;
  onClose: () => void;
}) {
  // what it last showed stays while it slides away
  const [shown, setShown] = useState(details);
  if (details && details !== shown) setShown(details);
  const [said, setSaid] = useState(how);
  if (how && how !== said) setSaid(how);
  const d = details ?? shown;
  return (
    <aside
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-label={d?.title ?? ""}
      tabIndex={-1}
      inert={!open}
      data-open={open}
      data-place={place}
      data-testid="inspection-panel"
      className={cn(
        "flex flex-col gap-3 overflow-y-auto bg-surface/95 p-5 outline-none ring-1 ring-hairline backdrop-blur-xl",
        "transition-[transform,opacity] duration-500 ease-cellr motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-accent-fg",
        place === "below"
          ? cn("rounded-card", open ? "opacity-100" : "hidden")
          : place === "beside"
            ? cn(
                "absolute inset-y-3 right-3 z-10 w-[min(26rem,46%)] rounded-card shadow-raised",
                open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-8 opacity-0",
              )
            : // the sheet: the lower 46 % of the picture, the share the bottle's frame leaves (three/layout PANEL)
              cn(
                "absolute inset-x-3 bottom-3 z-10 h-[calc(46%-0.75rem)] rounded-card shadow-raised",
                open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
              ),
      )}
    >
      {d && (
        <>
          <Line
            className="text-caption uppercase tracking-[0.16em] text-bronze"
            testid="inspection-how"
          >
            {how ?? said}
          </Line>
          <h2 className="font-display text-headline leading-tight" data-testid="inspection-title">
            {d.title}
          </h2>
          <Line className="text-small text-ink-2">{d.subtitle}</Line>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-hairline pt-3 text-small">
            {d.facts.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-ink-3">{name}</dt>
                <dd className="tnum">{value}</dd>
              </div>
            ))}
          </dl>
          <Line className="border-t border-hairline pt-3 text-small" testid="inspection-where">
            {d.where}
          </Line>
          <Line className="text-caption text-ink-3">{labels.turn}</Line>
          {d.actions && (
            <div className="mt-auto flex flex-col gap-2" data-testid="inspection-actions">
              {d.actions}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="inspection-back"
            className={cn(
              "inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-raised px-6 text-body font-medium text-ink transition-[transform,background-color] duration-150 ease-cellr hover:brightness-[1.04] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg",
              !d.actions && "mt-auto",
            )}
          >
            {labels.close}
          </button>
        </>
      )}
    </aside>
  );
}

function Line({
  className,
  testid,
  children,
}: {
  className: string;
  testid?: string;
  children: ReactNode;
}) {
  return (
    <p className={className} data-testid={testid}>
      {children}
    </p>
  );
}
