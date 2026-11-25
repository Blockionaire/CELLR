"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { useMyInvitations, useSharedRacks } from "./hooks";
import { PeopleIcon } from "./icons";
import { SharedRackStage } from "./rack-stage";
import { ManageSheet } from "./sheets";
import { closeManage, openManage, useManageOpen } from "./ui-store";
import { SharedRackUnplacedNote } from "./unplaced-note";

/**
 * SHARED RACKS IN THE CELLAR'S 3D SCREEN (ADR-010). Three pieces the cellar mounts where the server said shared racks
 * are open (through ./lazy, so none of this is downloaded otherwise):
 *   - chips for the row of places: the shared racks I am a member of, next to my own places;
 *   - the screen while one of them is the place on screen;
 *   - one calm line under the cellar: my shared racks, invitations, a new rack.
 */

/**
 * My shared racks as chips, to sit IN the cellar's row of places. Each says in words that it is shared (an icon, the
 * member count, and "Shared rack …" for a screen reader): never by colour alone. When someone invited me, one more
 * chip says so. Renders nothing while loading and when there is nothing to show, so the row is as it always was.
 */
export function SharedRackChips({
  selected = null,
  locked = false,
  onChoose,
}: {
  selected?: string | null;
  /** Something is being placed in my own cellar right now: another place is not chosen meanwhile. */
  locked?: boolean;
  onChoose: (rackId: string) => void;
}) {
  const t = useTranslations("sharedRacks");
  const racks = useSharedRacks();
  const invitations = useMyInvitations();
  const waiting = invitations.data?.invitations.length ?? 0;
  return (
    <>
      {(racks.data?.racks ?? []).map((r) => (
        <Chip
          key={r.id}
          // the same height as the cellar's own place chips (a thumb's height)
          className="h-11"
          selected={r.id === selected}
          disabled={locked}
          onClick={() => onChoose(r.id)}
          aria-label={t("chip.label", { name: r.name, count: r.memberCount })}
          data-testid="shared-rack-chip"
          data-rack={r.id}
        >
          <span className="inline-flex items-center gap-1.5">
            <PeopleIcon size={16} />
            {r.name}
            <span className="tnum opacity-80" aria-hidden="true">
              · {r.memberCount}
            </span>
          </span>
        </Chip>
      ))}
      {waiting > 0 && (
        <Chip
          onClick={openManage}
          data-testid="shared-rack-invitations-chip"
          className="h-11 border-accent-fg text-ink"
        >
          {t("chip.invitations", { count: waiting })}
        </Chip>
      )}
    </>
  );
}

const ROW = "-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0";

/**
 * The row of places for a cellar with ONE place of its own (the cellar shows no row then): that place, chosen, and
 * the shared racks next to it. Hidden while there is no shared rack to show, so the screen is as it always was.
 */
export function SharedRackSingleRow({
  place,
  locked,
  onChoose,
}: {
  place: { id: string; label: string };
  locked: boolean;
  onChoose: (rackId: string) => void;
}) {
  return (
    <div className={`${ROW} has-[>:only-child]:hidden`} data-testid="smart-3d-units">
      <Chip selected className="h-11">
        {place.label}
      </Chip>
      <SharedRackChips onChoose={onChoose} locked={locked} />
    </div>
  );
}

/** A cellar without a place of its own yet: the shared racks (when there are any) and the way in, above it. */
export function SharedRacksAlone({ onChoose }: { onChoose: (rackId: string) => void }) {
  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className={`${ROW} empty:hidden`} data-testid="smart-3d-units">
        <SharedRackChips onChoose={onChoose} />
      </div>
      <SharedRacksFooter onChoose={onChoose} />
    </div>
  );
}

/** The calm way in, under the cellar: bottles of mine that stand in a shared rack, and "Shared racks". */
export function SharedRacksFooter({ onChoose }: { onChoose: (rackId: string) => void }) {
  const t = useTranslations("sharedRacks");
  const open = useManageOpen();
  const invitations = useMyInvitations();
  const waiting = invitations.data?.invitations.length ?? 0;
  return (
    <div className="flex flex-col gap-3" data-testid="shared-racks-footer">
      <SharedRackUnplacedNote onOpen={onChoose} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="secondary" size="md" onClick={openManage} data-testid="shared-racks-entry">
          <PeopleIcon size={18} />
          {t("entry.link")}
          {waiting > 0 && (
            <span
              className="tnum rounded-full bg-accent px-2 text-caption text-accent-ink"
              data-testid="shared-racks-badge"
            >
              {t("chip.invitations", { count: waiting })}
            </span>
          )}
        </Button>
        <span className="text-small text-ink-2">{t("entry.what")}</span>
      </div>
      <ManageSheet
        open={open}
        onClose={closeManage}
        onChoose={(rackId) => {
          closeManage();
          onChoose(rackId);
        }}
      />
    </div>
  );
}

/**
 * The cellar's 3D screen while a shared rack is the place on screen: the same row of places (my own, then the shared
 * ones, this one chosen), the rack, and the line under it.
 */
export function SharedRackScreen({
  places,
  rackId,
  onOwnPlace,
  onShared,
  onShowRacks,
}: {
  /** My own places, as the cellar's row lists them. */
  places: ReadonlyArray<{ id: string; label: string }>;
  rackId: string;
  onOwnPlace: (placeId: string) => void;
  /** Another shared rack, or null: back to my own places. */
  onShared: (rackId: string | null) => void;
  onShowRacks: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="shared-rack-screen" data-rack={rackId}>
      <div className={ROW} data-testid="smart-3d-units">
        {places.map((p) => (
          <Chip key={p.id} className="h-11" onClick={() => onOwnPlace(p.id)}>
            {p.label}
          </Chip>
        ))}
        <SharedRackChips selected={rackId} onChoose={onShared} />
      </div>
      <SharedRackStage
        key={rackId}
        rackId={rackId}
        onGone={() => onShared(null)}
        onShowRacks={onShowRacks}
      />
      <SharedRacksFooter onChoose={onShared} />
    </div>
  );
}
