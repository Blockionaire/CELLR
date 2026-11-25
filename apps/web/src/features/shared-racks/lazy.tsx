"use client";

import dynamic from "next/dynamic";
import { lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { Skeleton } from "@/ui/skeleton";
import { useSharedRacksOpen } from "./gate";

/**
 * THE ONLY FILE OF SHARED RACKS THAT OTHER SCREENS IMPORT. It holds no logic and no words: only where the real code
 * is. That code (the chips, the rack's screen, the sheets, the queries) is downloaded when one of these is rendered,
 * and the cellar renders them only where the server said shared racks are open (lib/shared-racks-gate.ts). With the
 * gate closed nothing of it is fetched and nothing is asked of the API.
 *
 * Screens that live deep inside a page (a bottle's spot in a list, a sheet that moves bottles) do not get a prop for
 * the gate: the page sets `SharedRacksGate` from the server's decision, and the parts below that read it render
 * exactly what the screen rendered before while it is closed.
 */
export { SharedRacksGate, useSharedRacksOpen } from "./gate";

/** Shared racks as chips in the cellar's row of places (and "Invitations" when someone asked me). */
export const SharedRackChips = dynamic(
  () => import("./cellar-entry").then((m) => m.SharedRackChips),
  {
    ssr: false,
  },
);

/** The row of places for a cellar with one place of its own: that place and the shared racks. */
export const SharedRackSingleRow = dynamic(
  () => import("./cellar-entry").then((m) => m.SharedRackSingleRow),
  { ssr: false },
);

/** For a cellar without a place of its own: the shared racks and the way in. */
export const SharedRacksAlone = dynamic(
  () => import("./cellar-entry").then((m) => m.SharedRacksAlone),
  { ssr: false },
);

/** The cellar's 3D screen while a shared rack is the place on screen. */
export const SharedRackScreen = dynamic(
  () => import("./cellar-entry").then((m) => m.SharedRackScreen),
  { ssr: false, loading: () => <Skeleton className="h-[26rem]" /> },
);

/** The calm way in under the cellar: my shared racks, invitations, a new rack. */
export const SharedRacksFooter = dynamic(
  () => import("./cellar-entry").then((m) => m.SharedRacksFooter),
  { ssr: false },
);

/** In my own cellar's list of bottles without a place: which of them stand in a shared rack. */
export const SharedRackUnplacedNote = dynamic(
  () => import("./unplaced-note").then((m) => m.SharedRackUnplacedNote),
  { ssr: false },
);

/** Next to a bottle listed "without a place": where it stands in a shared rack, if it does. */
export const SharedPlaceBadgeFor = dynamic(
  () => import("./in-shared-rack").then((m) => m.SharedPlaceBadgeFor),
  { ssr: false },
);

/** Before a bottle is given a place at home: asks first when it stands in a shared rack, else goes through. */
export const SharedPlaceAsk = dynamic(
  () => import("./in-shared-rack").then((m) => m.SharedPlaceAsk),
  { ssr: false },
);

/** The same question as a sheet of its own (for a screen without room for it, or one that asks from a sheet). */
export const SharedPlaceAskSheet = dynamic(
  () => import("./in-shared-rack").then((m) => m.SharedPlaceAskSheet),
  { ssr: false },
);

/** Under a count of bottles without a place: how many of them stand in a shared rack. */
export const SharedPlaceCount = dynamic(
  () => import("./in-shared-rack").then((m) => m.SharedPlaceCount),
  { ssr: false },
);

const PlaceLine = lazy(() =>
  import("./in-shared-rack").then((m) => ({ default: m.SharedPlaceLine })),
);
const noSubscription = () => () => {};

/**
 * Where a screen says "Not placed" for bottles of mine without a place: what is true instead, when shared racks are
 * open (the words of `in-shared-rack.tsx`: "In shared rack Cellar club · shelf 2, spot 3"). The screen's own words
 * (`children`) stay until the answer is in, and always when shared racks are closed: then nothing else is rendered,
 * fetched or downloaded.
 */
export function SharedPlaceOr({
  bottleIds,
  vintageId,
  children,
}: {
  /** The bottles the words are about. */
  bottleIds?: readonly string[] | undefined;
  /** Or: every bottle of this wine without a place in my own cellar. */
  vintageId?: string | undefined;
  children: ReactNode;
}) {
  const open = useSharedRacksOpen();
  // not on the server, as the stubs above: the first picture is the screen's own words
  const browser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!open || !browser) return <>{children}</>;
  return (
    <Suspense fallback={children}>
      <PlaceLine bottleIds={bottleIds} vintageId={vintageId} fallback={children} />
    </Suspense>
  );
}

/** The same words as text, for a screen that can only show a string (an option of a select). Draws nothing. */
export const SharedPlaceTexts = dynamic(
  () => import("./in-shared-rack").then((m) => m.SharedPlaceTexts),
  { ssr: false },
);
