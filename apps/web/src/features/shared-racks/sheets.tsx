"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  ERROR_MESSAGES,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  SharedRackCreateSchema,
  SharedRackLayoutSchema,
  defaultAppearance,
  formatVintage,
  sharedRackRoleChangeProblem,
  templateSavable,
  type FoundPerson,
  type SharedRackBottleView,
  type SharedRackEventView,
  type SharedRackLayout,
  type SharedRackMemberView,
  type SharedRackSpot,
  type SharedRackView,
  type StorageTemplateId,
} from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { useRacks } from "@/features/cellar/hooks";
import { Button, buttonStyles } from "@/ui/button";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { useToast } from "@/ui/toast";
import {
  useAllSharedRacks,
  useArchiveSharedRack,
  useCancelInvitation,
  useCreateSharedRack,
  useFindPerson,
  useInvite,
  useLeaveSharedRack,
  useMyInvitations,
  useMySharedBottles,
  useRemoveMember,
  useRenameSharedRack,
  useRespondInvitation,
  useSaveSharedRackLayout,
  useSetMemberRole,
  useSharedRackEvents,
  useSharedRackInvitations,
  useSharedRacks,
  type EventFilter,
} from "./hooks";
import { PeopleIcon } from "./icons";
import {
  bottleName,
  canLeave,
  candidates,
  eventLine,
  isNotSetUp,
  leftTheRack,
  memberName,
  type Candidate,
} from "./logic";

/** The words for a failure, in the person's language (the app's own rule: lib/api.ts). */
export function useErrorText() {
  const te = useTranslations();
  return (error: unknown) => errorMessage(error, (key) => te(key), ERROR_MESSAGES);
}

const selectClass =
  "h-12 w-full min-w-0 rounded-control border border-hairline bg-surface px-3 text-body text-ink focus-visible:border-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg/30";

/** A labelled choice from a short list (the native control: it works everywhere, with every input). */
function Select({
  label,
  value,
  onChange,
  children,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-medium text-ink-2">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
        data-testid={testId}
      >
        {children}
      </select>
    </div>
  );
}

/** "Are you sure", with what it means said first. Nothing happens until the second button. */
function Confirm({
  children,
  confirm,
  onConfirm,
  onCancel,
  busy,
  danger = false,
}: {
  children: ReactNode;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  danger?: boolean;
}) {
  const tc = useTranslations("common");
  return (
    <div
      role="group"
      data-testid="shared-rack-confirm"
      className="flex flex-col gap-3 rounded-card border border-hairline bg-raised p-4"
    >
      <div className="flex flex-col gap-1 text-small text-ink">{children}</div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="md"
          variant={danger ? "danger" : "primary"}
          loading={busy}
          onClick={onConfirm}
          data-testid="shared-rack-confirm-yes"
        >
          {confirm}
        </Button>
        <Button size="md" variant="ghost" onClick={onCancel} disabled={busy}>
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}

// ---- A bottle of mine onto a spot ---------------------------------------------------------------------------------

/**
 * Which of MY bottles goes on the chosen spot: those without a place first, then those standing in a place of my own
 * (they leave it), searchable. Only my own household's bottles are ever listed; the server refuses any other.
 */
export function AddBottleSheet({
  open,
  spot,
  busy,
  onChoose,
  onClose,
}: {
  open: boolean;
  spot: SharedRackSpot | null;
  busy: boolean;
  onChoose: (candidate: Candidate) => void;
  onClose: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const racks = useRacks(open);
  const mine = useMySharedBottles(open);
  const [search, setSearch] = useState("");
  const list = useMemo(
    () => candidates(racks.data, mine.data?.bottles, search),
    [racks.data, mine.data, search],
  );
  const total = useMemo(
    () => candidates(racks.data, mine.data?.bottles).length,
    [racks.data, mine.data],
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("add.title")}
      description={spot ? t("add.onSpot", { row: spot.row, col: spot.col }) : undefined}
    >
      <div className="flex flex-col gap-3" data-testid="shared-rack-add-sheet">
        <p className="text-small text-ink-2">{t("add.ownOnly")}</p>
        {total > 6 && (
          <Field
            label={t("add.search")}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {!racks.data || !mine.data ? (
          racks.isError || mine.isError ? (
            <p role="alert" className="text-small text-danger">
              {t("add.loadFailed")}
            </p>
          ) : (
            <Skeleton className="h-24" />
          )
        ) : total === 0 ? (
          <p className="text-small text-ink-2" data-testid="shared-rack-add-none">
            {t("add.none")}
          </p>
        ) : list.length === 0 ? (
          <p className="text-small text-ink-2">{t("add.noMatch")}</p>
        ) : (
          <ul
            className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto"
            aria-label={t("add.listLabel")}
          >
            {list.map((c) => (
              <li key={c.bottleId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(c)}
                  data-testid="shared-rack-candidate"
                  data-bottle={c.bottleId}
                  className="flex min-h-12 w-full flex-col items-start justify-center rounded-control px-3 py-2 text-left hover:bg-raised disabled:opacity-50"
                >
                  <span className="text-body text-ink">{c.name}</span>
                  <span className="text-caption text-ink-2">
                    {c.from
                      ? t("add.fromPlace", { unit: c.from.unit, row: c.from.row, col: c.from.col })
                      : t("add.noPlace")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

// ---- Taking a bottle out ------------------------------------------------------------------------------------------

/**
 * "I took this bottle out", said honestly before it is recorded: taking out is not drinking. For someone else's
 * bottle: it stays theirs and the history tells them. For my own: it is in my cellar without a place afterwards, and
 * what happens next (drinking it, giving it a place at home) is done in my own cellar, offered after the taking out.
 */
export function TakeOutSheet({
  open,
  bottle,
  rackName,
  done,
  busy,
  onConfirm,
  onClose,
  onShowRacks,
}: {
  open: boolean;
  bottle: SharedRackBottleView | null;
  rackName: string;
  /** Recorded: for my own bottle, where to go from here. */
  done: { vintageId: string | null } | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onShowRacks: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const wine = bottle ? bottleName(bottle) : "";
  return (
    <Sheet open={open} onClose={onClose} title={t("takeOut.title")}>
      {bottle && (
        <div className="flex flex-col gap-4" data-testid="shared-rack-takeout-sheet">
          {done ? (
            <>
              <p className="text-body text-ink" data-testid="shared-rack-takeout-done">
                {t("takeOut.doneMine", { wine })}
              </p>
              <p className="text-small text-ink-2">{t("takeOut.nextMine")}</p>
              <div className="flex flex-col gap-2">
                {done.vintageId && (
                  <Link
                    href={`/cellar/${done.vintageId}`}
                    className={buttonStyles({ variant: "primary", block: true })}
                    data-testid="shared-rack-takeout-wine"
                  >
                    {t("takeOut.openWine")}
                  </Link>
                )}
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    onClose();
                    onShowRacks();
                  }}
                >
                  {t("takeOut.placeAtHome")}
                </Button>
                <Button variant="ghost" block onClick={onClose}>
                  {t("takeOut.later")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-body text-ink">{t("takeOut.what", { wine, rack: rackName })}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-ink-2">
                <li>{t("takeOut.notDrinking")}</li>
                <li>
                  {bottle.mine
                    ? t("takeOut.mine")
                    : t("takeOut.theirs", { owner: bottle.owner.name ?? t("someone") })}
                </li>
                <li>{t("takeOut.history")}</li>
              </ul>
              <div className="flex flex-col gap-2">
                <Button
                  block
                  loading={busy}
                  onClick={onConfirm}
                  data-testid="shared-rack-takeout-confirm"
                >
                  {t("takeOut.confirm")}
                </Button>
                <Button variant="ghost" block onClick={onClose} disabled={busy}>
                  {tc("cancel")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---- People -------------------------------------------------------------------------------------------------------

type Pending =
  | { kind: "remove"; member: SharedRackMemberView }
  | { kind: "role"; member: SharedRackMemberView; role: "owner" | "member" }
  | { kind: "leave" };

/**
 * Who is in the rack and what each role may do; inviting someone who already uses CELLR (found by their exact
 * account name or friend code: the existing search); taking back an invitation; changing a role; removing someone;
 * leaving. Every confirmation says what happens to bottles: they stay their owner's, and stay where they stand.
 */
export function PeopleSheet({
  open,
  onClose,
  rack,
  members,
  writes,
  onLeft,
}: {
  open: boolean;
  onClose: () => void;
  rack: SharedRackView;
  members: readonly SharedRackMemberView[] | undefined;
  writes: boolean;
  onLeft: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const toast = useToast();
  const say = useErrorText();
  const owner = rack.role === "owner";
  const invitations = useSharedRackInvitations(rack.id, open && owner);
  const find = useFindPerson();
  const invite = useInvite(rack.id);
  const cancel = useCancelInvitation();
  const setRole = useSetMemberRole(rack.id);
  const remove = useRemoveMember(rack.id);
  const leave = useLeaveSharedRack(rack.id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; person: FoundPerson | null } | null>(null);
  const fail = (error: unknown) => toast.show(say(error), { tone: "error" });
  const mayLeave = members ? canLeave(members) : false;
  const otherOwners = (m: SharedRackMemberView) =>
    (members ?? []).filter((x) => x.userId !== m.userId && x.role === "owner").length;
  const open_ = invitations.data?.invitations.filter((i) => i.state === "pending") ?? [];

  const search = () => {
    const query = q.trim();
    if (query.length < 3) return;
    find.mutate(query, {
      onSuccess: (out) => setFound({ q: query, person: out.person }),
      onError: fail,
    });
  };
  const confirm = () => {
    if (!pending) return;
    const done = () => setPending(null);
    if (pending.kind === "remove")
      remove.mutate(pending.member.userId, {
        onSuccess: () => {
          done();
          toast.show(t("people.removed", { name: memberName(pending.member) ?? t("someone") }));
        },
        onError: fail,
      });
    else if (pending.kind === "role")
      setRole.mutate(
        { userId: pending.member.userId, role: pending.role },
        { onSuccess: done, onError: fail },
      );
    else
      leave.mutate(undefined, {
        onSuccess: () => {
          done();
          toast.show(t("people.left", { rack: rack.name }));
          onLeft();
        },
        onError: fail,
      });
  };
  const busy = remove.isPending || setRole.isPending || leave.isPending;

  return (
    <Sheet open={open} onClose={onClose} title={t("people.title")} description={rack.name}>
      <div className="flex flex-col gap-5" data-testid="shared-rack-people">
        <div className="flex flex-col gap-1 text-small text-ink-2">
          <p>{t("people.roleOwner")}</p>
          <p>{t("people.roleMember")}</p>
          <p>{t("people.bottlesStay")}</p>
        </div>

        {!members ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t("people.listLabel")}>
            {members.map((m) => {
              const name = memberName(m) ?? t("someone");
              const canDemote = sharedRackRoleChangeProblem({
                from: m.role,
                to: "member",
                otherOwners: otherOwners(m),
              });
              return (
                <li
                  key={m.userId}
                  data-testid="shared-rack-member"
                  data-user={m.userId}
                  className="flex flex-col gap-2 rounded-card bg-raised p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-body text-ink">
                      {name}
                      {m.isMe && <span className="text-ink-2"> · {t("you")}</span>}
                    </span>
                    <span className="text-small text-ink-2">
                      {t(`roles.${m.role}`)} · {t("people.bottles", { count: m.bottleCount })}
                    </span>
                  </div>
                  {owner && writes && (
                    <div className="flex flex-wrap gap-2">
                      {m.role === "member" ? (
                        <Button
                          size="md"
                          variant="secondary"
                          onClick={() => setPending({ kind: "role", member: m, role: "owner" })}
                          data-testid="shared-rack-make-owner"
                        >
                          {t("people.makeOwner")}
                        </Button>
                      ) : canDemote === null ? (
                        <Button
                          size="md"
                          variant="secondary"
                          onClick={() => setPending({ kind: "role", member: m, role: "member" })}
                        >
                          {t("people.makeMember")}
                        </Button>
                      ) : null}
                      {!m.isMe && (
                        <Button
                          size="md"
                          variant="danger"
                          onClick={() => setPending({ kind: "remove", member: m })}
                          data-testid="shared-rack-remove-member"
                        >
                          {t("people.remove")}
                        </Button>
                      )}
                    </div>
                  )}
                  {pending && pending.kind !== "leave" && pending.member.userId === m.userId && (
                    <Confirm
                      confirm={
                        pending.kind === "remove"
                          ? t("people.removeConfirm")
                          : pending.role === "owner"
                            ? t("people.makeOwner")
                            : t("people.makeMember")
                      }
                      danger={pending.kind === "remove"}
                      busy={busy}
                      onConfirm={confirm}
                      onCancel={() => setPending(null)}
                    >
                      {pending.kind === "remove" ? (
                        <>
                          <p>{t("people.removeWhat", { name })}</p>
                          <p className="text-ink-2">{t("people.removeBottles", { name })}</p>
                        </>
                      ) : pending.role === "owner" ? (
                        <p>{t("people.makeOwnerWhat", { name })}</p>
                      ) : (
                        <p>{t("people.makeMemberWhat", { name })}</p>
                      )}
                    </Confirm>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {owner && writes && !rack.archived && (
          <section className="flex flex-col gap-3" aria-labelledby="sr-invite-h">
            <h3 id="sr-invite-h" className="font-display text-title text-ink">
              {t("people.inviteTitle")}
            </h3>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                search();
              }}
            >
              <Field
                className="min-w-0 flex-1"
                label={t("people.inviteLabel")}
                hint={t("people.inviteHint")}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setFound(null);
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                data-testid="shared-rack-invite-q"
              />
              <Button type="submit" variant="secondary" loading={find.isPending} className="mb-6">
                {t("people.find")}
              </Button>
            </form>
            {found &&
              (found.person ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-raised p-3"
                  data-testid="shared-rack-found"
                >
                  <span className="text-body text-ink">
                    {found.person.displayName ??
                      (found.person.handle ? `@${found.person.handle}` : found.q)}
                  </span>
                  <Button
                    size="md"
                    loading={invite.isPending}
                    data-testid="shared-rack-invite"
                    onClick={() =>
                      invite.mutate(found.person!.userId, {
                        onSuccess: (out) => {
                          toast.show(
                            t(
                              out.outcome === "invited"
                                ? "people.invited"
                                : "people.alreadyInvited",
                            ),
                          );
                          setFound(null);
                          setQ("");
                        },
                        onError: fail,
                      })
                    }
                  >
                    {t("people.invite")}
                  </Button>
                </div>
              ) : (
                <p
                  role="status"
                  className="text-small text-ink-2"
                  data-testid="shared-rack-not-found"
                >
                  {t("people.notFound")}
                </p>
              ))}
            {open_.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label={t("people.pendingLabel")}>
                {open_.map((i) => (
                  <li
                    key={i.id}
                    data-testid="shared-rack-pending"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-raised p-3"
                  >
                    <span className="text-small text-ink">
                      {t("people.pending", {
                        name: i.displayName ?? (i.handle ? `@${i.handle}` : t("someone")),
                      })}
                    </span>
                    <Button
                      size="md"
                      variant="ghost"
                      loading={cancel.isPending && cancel.variables === i.id}
                      onClick={() => cancel.mutate(i.id, { onError: fail })}
                      data-testid="shared-rack-cancel-invitation"
                    >
                      {t("people.cancelInvitation")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {writes && members && (
          <section className="flex flex-col gap-2 border-t border-hairline pt-4">
            {mayLeave ? (
              pending?.kind === "leave" ? (
                <Confirm
                  confirm={t("people.leave")}
                  danger
                  busy={busy}
                  onConfirm={confirm}
                  onCancel={() => setPending(null)}
                >
                  <p>{t("people.leaveWhat", { rack: rack.name })}</p>
                  <p className="text-ink-2">{t("people.leaveBottles")}</p>
                </Confirm>
              ) : (
                <Button
                  variant="danger"
                  block
                  onClick={() => setPending({ kind: "leave" })}
                  data-testid="shared-rack-leave"
                >
                  {t("people.leave")}
                </Button>
              )
            ) : (
              // said before any request is made: the last owner cannot leave
              <p className="text-small text-ink-2" data-testid="shared-rack-last-owner">
                {t("people.lastOwner")}
              </p>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}

// ---- Activity -----------------------------------------------------------------------------------------------------

/** The rack's history: who did what with whose bottle, newest first, a page at a time. */
export function ActivitySheet({
  open,
  onClose,
  rack,
  members,
  bottle,
  onAllBottles,
}: {
  open: boolean;
  onClose: () => void;
  rack: SharedRackView;
  members: readonly SharedRackMemberView[] | undefined;
  /** Only this bottle's history (from a bottle's panel). */
  bottle: { placementId: string; name: string } | null;
  onAllBottles: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const locale = useLocale();
  const say = useErrorText();
  const [owner, setOwner] = useState("");
  const [actor, setActor] = useState("");
  // every opening starts unfiltered: "the history of this bottle" must not inherit a filter chosen an hour ago
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setOwner("");
      setActor("");
    }
  }
  const filter: EventFilter = useMemo(
    () => ({
      ...(owner ? { owner } : {}),
      ...(actor ? { actor } : {}),
      ...(bottle ? { placement: bottle.placementId } : {}),
    }),
    [owner, actor, bottle],
  );
  const query = useSharedRackEvents(rack.id, filter, open);
  const events = query.data?.pages.flatMap((p) => p.events) ?? [];
  const when = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );
  const spot = (s: SharedRackSpot | null) => (s ? t("spot", { row: s.row, col: s.col }) : "");
  const sentence = (e: SharedRackEventView) => {
    const role = typeof e.detail?.to === "string" ? e.detail.to : "";
    // the key is one of the sentences under `events` (logic.ts builds it from the event's own type)
    return t(`events.${eventLine(e).key}` as "events.rack_created", {
      actor: e.actor.name ?? t("someone"),
      owner: e.owner?.name ?? t("someone"),
      subject: e.subject?.name ?? t("someone"),
      wine: e.wine?.name
        ? `${e.wine.producer ?? ""} ${e.wine.name} ${formatVintage(e.wine.year)}`.trim()
        : t("aBottle"),
      from: spot(e.from),
      to: spot(e.to),
      name: typeof e.detail?.to === "string" ? e.detail.to : rack.name,
      role: role === "owner" || role === "member" ? t(`rolesLower.${role}`) : role,
    });
  };
  const people = (members ?? []).map((m) => (
    <option key={m.userId} value={m.userId}>
      {m.isMe ? t("you") : (memberName(m) ?? t("someone"))}
    </option>
  ));

  return (
    <Sheet open={open} onClose={onClose} title={t("activity.title")} description={rack.name}>
      <div className="flex flex-col gap-4" data-testid="shared-rack-activity">
        {bottle ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-raised p-3">
            <span className="text-small text-ink" data-testid="shared-rack-activity-bottle">
              {t("activity.ofBottle", { wine: bottle.name })}
            </span>
            <Button size="md" variant="ghost" onClick={onAllBottles}>
              {t("activity.allBottles")}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Select
              label={t("activity.byOwner")}
              value={owner}
              onChange={setOwner}
              testId="shared-rack-activity-owner"
            >
              <option value="">{t("activity.everyone")}</option>
              {people}
            </Select>
            <Select
              label={t("activity.byActor")}
              value={actor}
              onChange={setActor}
              testId="shared-rack-activity-actor"
            >
              <option value="">{t("activity.everyone")}</option>
              {people}
            </Select>
          </div>
        )}
        {/* the list keeps its height while a page loads: nothing jumps under a finger */}
        <div className="min-h-40">
          {query.isPending ? (
            <Skeleton className="h-40" />
          ) : query.isError && events.length === 0 ? (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-small text-ink">{say(query.error)}</p>
              <Button size="md" variant="secondary" onClick={() => void query.refetch()}>
                {tc("retry")}
              </Button>
            </div>
          ) : events.length === 0 ? (
            <p className="text-small text-ink-2" data-testid="shared-rack-activity-empty">
              {t("activity.empty")}
            </p>
          ) : (
            <ol className="flex flex-col gap-3" aria-label={t("activity.listLabel")}>
              {events.map((e) => (
                <li
                  key={e.seq}
                  data-testid="shared-rack-event"
                  data-type={e.type}
                  className="flex flex-col"
                >
                  <span className="text-small text-ink">
                    {sentence(e)}
                    {leftTheRack(e) && (
                      <span className="text-ink-2"> · {t("activity.leftRack")}</span>
                    )}
                  </span>
                  <time dateTime={e.occurredAt} className="text-caption text-ink-3">
                    {when.format(new Date(e.occurredAt))}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
        {query.hasNextPage && (
          <Button
            variant="secondary"
            block
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            data-testid="shared-rack-activity-older"
          >
            {t("activity.older")}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

// ---- The rack itself: a new one, its name, its layout, archiving ---------------------------------------------------

const TEMPLATES = STORAGE_TEMPLATE_IDS.filter(templateSavable);

interface Draft {
  template: StorageTemplateId;
  rows: number;
  cols: number;
}

/** Which kind of rack and how large: the catalogue's own choices and limits (packages/domain), nothing else. */
function LayoutFields({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const t = useTranslations("sharedRacks");
  const tt = useTranslations("storageTemplates");
  const template = STORAGE_TEMPLATES[draft.template];
  const clamp = (value: number, limit: { min: number; max: number }) =>
    Number.isFinite(value)
      ? Math.min(limit.max, Math.max(limit.min, Math.round(value)))
      : limit.min;
  return (
    <div className="flex flex-col gap-3">
      <Select
        label={t("form.template")}
        value={draft.template}
        testId="shared-rack-template"
        onChange={(id) => {
          const next = STORAGE_TEMPLATES[id as StorageTemplateId];
          onChange({
            template: next.id,
            rows: clamp(draft.rows, next.rows),
            cols: clamp(draft.cols, next.cols),
          });
        }}
      >
        {TEMPLATES.map((id) => (
          <option key={id} value={id}>
            {tt(`${id}.name`)}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Field
          className="min-w-0 flex-1"
          label={t("form.rows")}
          type="number"
          inputMode="numeric"
          min={template.rows.min}
          max={template.rows.max}
          value={draft.rows}
          onChange={(e) => onChange({ ...draft, rows: Number(e.target.value) })}
          data-testid="shared-rack-rows"
        />
        <Field
          className="min-w-0 flex-1"
          label={t("form.cols")}
          type="number"
          inputMode="numeric"
          min={template.cols.min}
          max={template.cols.max}
          value={draft.cols}
          onChange={(e) => onChange({ ...draft, cols: Number(e.target.value) })}
          data-testid="shared-rack-cols"
        />
      </div>
      <p className="text-small text-ink-2 tnum">
        {t("form.capacity", { count: (draft.rows || 0) * (draft.cols || 0) })}
      </p>
    </div>
  );
}

/** The layout a draft stands for: one bottle per spot, no zones, the look kept where the template still offers it. */
function layoutOf(
  draft: Draft,
  keep: SharedRackView | null,
): SharedRackLayout | { issues: { message: string }[] } {
  const structure = {
    template: draft.template,
    rows: draft.rows,
    cols: draft.cols,
    cellCapacity: 1,
    zones: [],
  };
  if (keep && keep.templateId === draft.template) {
    const kept = SharedRackLayoutSchema.safeParse({ structure, appearance: keep.appearance });
    if (kept.success) return kept.data;
  }
  const parsed = SharedRackLayoutSchema.safeParse({
    structure,
    appearance: defaultAppearance(draft.template),
  });
  return parsed.success ? parsed.data : { issues: parsed.error.issues };
}

/** A new shared rack. Whoever makes it is its first owner. */
function NewRackForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rack: SharedRackView) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const te = useTranslations();
  const say = useErrorText();
  const create = useCreateSharedRack();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Draft>({ template: "rack_classic", rows: 5, cols: 12 });
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const layout = layoutOf(draft, null);
    const parsed =
      "issues" in layout ? null : SharedRackCreateSchema.safeParse({ name, ...layout });
    if (!parsed?.success) {
      const issues = "issues" in layout ? layout.issues : (parsed?.error.issues ?? []);
      return setError(checkMessage(issues, (key) => te(key)));
    }
    setError(null);
    create.mutate(parsed.data, { onSuccess: onCreated, onError: (e) => setError(say(e)) });
  };
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="shared-rack-new-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="text-small text-ink-2">{t("form.newWhat")}</p>
      <Field
        label={t("form.name")}
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        data-testid="shared-rack-name"
      />
      <LayoutFields draft={draft} onChange={setDraft} />
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button type="submit" block loading={create.isPending} data-testid="shared-rack-create">
          {t("form.create")}
        </Button>
        <Button variant="ghost" block onClick={onCancel} disabled={create.isPending}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Its name, its layout (saved against the version it was opened from) and archiving. Owners only. */
export function SettingsSheet({
  open,
  onClose,
  rack,
}: {
  open: boolean;
  onClose: () => void;
  rack: SharedRackView;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const say = useErrorText();
  const rename = useRenameSharedRack(rack.id);
  const save = useSaveSharedRackLayout(rack.id);
  const archive = useArchiveSharedRack(rack.id);
  const known = (STORAGE_TEMPLATE_IDS as readonly string[]).includes(rack.templateId);
  // the fields start again from the rack whenever the rack itself changed (someone else saved it): never a stale draft
  const [seen, setSeen] = useState(rack.revision);
  const [name, setName] = useState(rack.name);
  const [draft, setDraft] = useState<Draft>({
    template: known ? (rack.templateId as StorageTemplateId) : "rack_classic",
    rows: rack.rows,
    cols: rack.cols,
  });
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  if (seen !== rack.revision) {
    setSeen(rack.revision);
    setName(rack.name);
    setDraft({
      template: known ? (rack.templateId as StorageTemplateId) : "rack_classic",
      rows: rack.rows,
      cols: rack.cols,
    });
  }
  const saveLayout = () => {
    const layout = layoutOf(draft, rack);
    if ("issues" in layout) return setError(checkMessage(layout.issues, (key) => te(key)));
    setError(null);
    setStale(false);
    save.mutate(
      { layout, revision: rack.revision },
      {
        onSuccess: () => toast.show(t("settings.layoutSaved")),
        onError: (e) => {
          // someone else changed the rack meanwhile: say so; the fields take the latest version when it arrives
          setError(say(e));
          setStale(true);
        },
      },
    );
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("settings.title")} description={rack.name}>
      <div className="flex flex-col gap-6" data-testid="shared-rack-settings">
        {!rack.archived && (
          <>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                rename.mutate(name, {
                  onSuccess: () => toast.show(tc("saved")),
                  onError: (err) => toast.show(say(err), { tone: "error" }),
                });
              }}
            >
              <Field
                className="min-w-0 flex-1"
                label={t("form.name")}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                data-testid="shared-rack-rename"
              />
              <Button type="submit" variant="secondary" loading={rename.isPending}>
                {tc("save")}
              </Button>
            </form>
            <section className="flex flex-col gap-3" aria-labelledby="sr-layout-h">
              <h3 id="sr-layout-h" className="font-display text-title text-ink">
                {t("settings.layoutTitle")}
              </h3>
              <p className="text-small text-ink-2">{t("settings.layoutBody")}</p>
              <LayoutFields draft={draft} onChange={setDraft} />
              {error && (
                <p
                  role="alert"
                  className="text-small text-danger"
                  data-testid="shared-rack-layout-error"
                >
                  {error}
                  {stale ? ` ${t("settings.reloaded")}` : ""}
                </p>
              )}
              <Button
                variant="secondary"
                loading={save.isPending}
                onClick={saveLayout}
                data-testid="shared-rack-save-layout"
              >
                {t("settings.saveLayout")}
              </Button>
            </section>
          </>
        )}
        <section className="flex flex-col gap-3 border-t border-hairline pt-4">
          {rack.archived ? (
            <>
              <p className="text-small text-ink-2">{t("settings.archivedBody")}</p>
              <Button
                variant="secondary"
                loading={archive.isPending}
                onClick={() =>
                  archive.mutate(false, { onError: (e) => toast.show(say(e), { tone: "error" }) })
                }
                data-testid="shared-rack-restore"
              >
                {t("settings.restore")}
              </Button>
            </>
          ) : confirming ? (
            <Confirm
              confirm={t("settings.archive")}
              danger
              busy={archive.isPending}
              onCancel={() => setConfirming(false)}
              onConfirm={() =>
                archive.mutate(true, {
                  onSuccess: () => setConfirming(false),
                  onError: (e) => toast.show(say(e), { tone: "error" }),
                })
              }
            >
              <p>{t("settings.archiveWhat")}</p>
              <p className="text-ink-2">{t("settings.archiveBottles")}</p>
            </Confirm>
          ) : (
            <Button
              variant="danger"
              onClick={() => setConfirming(true)}
              data-testid="shared-rack-archive"
            >
              {t("settings.archive")}
            </Button>
          )}
        </section>
      </div>
    </Sheet>
  );
}

// ---- My shared racks: the list, invitations for me, a new rack ------------------------------------------------------

export function ManageSheet({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  /** Open this rack in the cellar's 3D view. */
  onChoose: (rackId: string) => void;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const toast = useToast();
  const say = useErrorText();
  const racks = useSharedRacks(open);
  const [archived, setArchived] = useState(false);
  const all = useAllSharedRacks(open && archived);
  const invitations = useMyInvitations(open);
  const respond = useRespondInvitation();
  const [creating, setCreating] = useState(false);
  const list = (archived ? all.data?.racks : undefined) ?? racks.data?.racks;
  const writes = racks.data?.writes ?? false;
  const failure = racks.error ?? invitations.error;

  return (
    <Sheet open={open} onClose={onClose} title={t("manage.title")} description={t("manage.what")}>
      <div className="flex flex-col gap-5" data-testid="shared-racks-manage">
        {failure && !racks.data ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-2"
            data-testid="shared-racks-failed"
          >
            <p className="text-small text-ink">
              {isNotSetUp(failure) ? t("notSetUp") : say(failure)}
            </p>
            {!isNotSetUp(failure) && (
              <Button
                size="md"
                variant="secondary"
                onClick={() => {
                  void racks.refetch();
                  void invitations.refetch();
                }}
              >
                {tc("retry")}
              </Button>
            )}
          </div>
        ) : creating ? (
          <NewRackForm
            onCancel={() => setCreating(false)}
            onCreated={(rack) => {
              setCreating(false);
              toast.show(t("manage.created", { rack: rack.name }));
              onChoose(rack.id);
            }}
          />
        ) : (
          <>
            {(invitations.data?.invitations.length ?? 0) > 0 && (
              <section className="flex flex-col gap-2" aria-labelledby="sr-inv-h">
                <h3 id="sr-inv-h" className="font-display text-title text-ink">
                  {t("manage.invitations")}
                </h3>
                <ul className="flex flex-col gap-2">
                  {invitations.data!.invitations.map((i) => (
                    <li
                      key={i.id}
                      data-testid="shared-rack-invitation"
                      className="flex flex-col gap-2 rounded-card bg-raised p-3"
                    >
                      <p className="text-body text-ink">
                        {t("manage.invitedBy", {
                          name: i.invitedBy ?? t("someone"),
                          rack: i.rackName,
                        })}
                      </p>
                      <p className="text-small text-ink-2">{t("manage.acceptWhat")}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="md"
                          disabled={!writes}
                          loading={
                            respond.isPending &&
                            respond.variables?.invitationId === i.id &&
                            respond.variables.accept
                          }
                          data-testid="shared-rack-accept"
                          onClick={() =>
                            respond.mutate(
                              { invitationId: i.id, accept: true },
                              {
                                onSuccess: (out) => {
                                  toast.show(t("manage.accepted", { rack: i.rackName }));
                                  if (out.rackId) onChoose(out.rackId);
                                },
                                onError: (e) => toast.show(say(e), { tone: "error" }),
                              },
                            )
                          }
                        >
                          {t("manage.accept")}
                        </Button>
                        <Button
                          size="md"
                          variant="ghost"
                          disabled={!writes || respond.isPending}
                          data-testid="shared-rack-decline"
                          onClick={() =>
                            respond.mutate(
                              { invitationId: i.id, accept: false },
                              {
                                onSuccess: () => toast.show(t("manage.declined")),
                                onError: (e) => toast.show(say(e), { tone: "error" }),
                              },
                            )
                          }
                        >
                          {t("manage.decline")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="flex flex-col gap-2" aria-labelledby="sr-racks-h">
              <h3 id="sr-racks-h" className="font-display text-title text-ink">
                {t("manage.myRacks")}
              </h3>
              {/* the list keeps its room while it loads */}
              <div className="min-h-16">
                {!list ? (
                  <Skeleton className="h-16" />
                ) : list.length === 0 ? (
                  <p className="text-small text-ink-2" data-testid="shared-racks-none">
                    {t("manage.none")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {list.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => onChoose(r.id)}
                          data-testid="shared-racks-open"
                          data-rack={r.id}
                          className="flex min-h-14 w-full items-center gap-3 rounded-card bg-raised p-3 text-left hover:brightness-[1.03]"
                        >
                          <PeopleIcon size={20} className="shrink-0 text-ink-2" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-body text-ink">{r.name}</span>
                            <span className="text-caption text-ink-2">
                              {t(`roles.${r.role}`)} · {t("members", { count: r.memberCount })} ·{" "}
                              {t("occupancy", { used: r.occupied, capacity: r.capacity })}
                              {r.archived ? ` · ${t("archived")}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <label className="flex min-h-11 items-center gap-2 text-small text-ink-2">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                  data-testid="shared-racks-archived"
                />
                {t("manage.showArchived")}
              </label>
            </section>
            {writes ? (
              <Button
                variant="secondary"
                block
                onClick={() => setCreating(true)}
                data-testid="shared-rack-new"
              >
                {t("manage.new")}
              </Button>
            ) : (
              racks.data && <p className="text-small text-ink-2">{t("readOnly")}</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
