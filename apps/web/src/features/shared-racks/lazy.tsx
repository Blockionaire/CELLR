"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/ui/skeleton";

/**
 * THE ONLY FILE OF SHARED RACKS THAT OTHER SCREENS IMPORT. It holds no logic and no words: only where the real code
 * is. That code (the chips, the rack's screen, the sheets, the queries) is downloaded when one of these is rendered,
 * and the cellar renders them only where the server said shared racks are open (lib/shared-racks-gate.ts). With the
 * gate closed nothing of it is fetched and nothing is asked of the API.
 */

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
