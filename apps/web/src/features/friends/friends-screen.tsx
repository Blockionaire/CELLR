"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  FindPersonSchema,
  HandleSchema,
  type FoundPerson,
  type FriendEntry,
  type FriendsView,
  type SharingView,
} from "@cellr/domain";
import { ConfirmSheet } from "@/features/account/confirm-sheet";
import { Button, buttonStyles } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Field } from "@/ui/field";
import { ChevronRightIcon, CopyIcon, SearchIcon, ShareIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { useToast } from "@/ui/toast";
import {
  useFindPerson,
  useFriends,
  useRemoveFriend,
  useRespond,
  useSendRequest,
  useSetHandle,
} from "./hooks";
import { Card, personName, PersonRow } from "./person";
import { SharingCard } from "./sharing-card";

/** "ABCD2345" → "ABCD 2345": easier to read out loud. */
export const spacedCode = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

/** Friends: who I am to them (account name and code), finding someone, requests both ways, and what I share. */
export function FriendsScreen({
  initial,
  initialSharing,
}: {
  initial: FriendsView;
  initialSharing: SharingView | null;
}) {
  const t = useTranslations("friends");
  const data = useFriends(initial).data ?? initial;

  if (!data.ready)
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState title={t("notReadyTitle")} body={t("notReadyBody")} />
      </>
    );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <MeCard handle={data.me.handle} code={data.me.friendCode ?? ""} />
        <FindCard />
        {data.incoming.length > 0 && <IncomingCard requests={data.incoming} />}
        <FriendsCard friends={data.friends} />
        {data.outgoing.length > 0 && <OutgoingCard requests={data.outgoing} />}
        <SharingCard initial={initialSharing} friends={data.friends} />
      </div>
    </>
  );
}

function MeCard({ handle, code }: { handle: string | null; code: string }) {
  const t = useTranslations("friends");
  const tc = useTranslations("common");
  const toast = useToast();
  const save = useSetHandle();
  const [editing, setEditing] = useState(handle === null);
  const [value, setValue] = useState(handle ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = HandleSchema.safeParse(value);
    if (!parsed.success) return setError(t("handleInvalid"));
    setError(null);
    if (parsed.data === handle) return setEditing(false);
    save.mutate(parsed.data, {
      onSuccess: () => setEditing(false),
      onError: () => setError(null),
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast.show(tc("copied"));
    } catch {
      toast.show(code);
    }
  }

  async function share() {
    const text = handle ? t("shareTextHandle", { handle, code }) : t("shareText", { code });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "CELLR", text });
      } catch {
        // dismissed
      }
      return;
    }
    await copy();
  }

  return (
    <Card title={t("meTitle")} testId="me">
      {editing ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field
            label={t("handleLabel")}
            hint={t("handleHint")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={error}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={21}
            placeholder="@"
          />
          <div className="flex gap-2">
            <Button type="submit" loading={save.isPending}>
              {tc("save")}
            </Button>
            {handle !== null && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {tc("cancel")}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-small text-ink-2">{t("handleLabel")}</p>
            <p className="truncate font-display text-headline" data-testid="my-handle">
              @{handle}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {t("change")}
          </Button>
        </div>
      )}

      <div className="mt-5 rounded-[20px] bg-raised px-4 py-5 text-center ring-1 ring-hairline">
        <p className="text-small text-ink-2">{t("codeLabel")}</p>
        <p
          className="mt-1 select-all font-display text-display tracking-[0.12em] tnum"
          data-testid="my-code"
          aria-label={t("codeSpoken", { code: code.split("").join(" ") })}
        >
          {spacedCode(code)}
        </p>
        <p className="mt-1 text-caption text-ink-3">{t("codeHint")}</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={copy}>
          <CopyIcon size={18} />
          {tc("copy")}
        </Button>
        <Button variant="secondary" onClick={share}>
          <ShareIcon size={18} />
          {tc("share")}
        </Button>
      </div>
    </Card>
  );
}

function FindCard() {
  const t = useTranslations("friends");
  const find = useFindPerson();
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = FindPersonSchema.safeParse({ q });
    if (!parsed.success) return setError(t("findTooShort"));
    setError(null);
    find.mutate(parsed.data.q);
  }

  const found = find.data?.person;
  return (
    <Card title={t("findTitle")} testId="find">
      <form onSubmit={submit} noValidate role="search" className="flex items-start gap-2">
        <Field
          label={t("findLabel")}
          hideLabel
          placeholder={t("findPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          error={error}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          className="flex-1"
        />
        <Button
          type="submit"
          loading={find.isPending}
          aria-label={t("findButton")}
          className="h-12"
        >
          <SearchIcon size={20} />
          <span className="max-[380px]:sr-only">{t("findButton")}</span>
        </Button>
      </form>
      <p className="mt-2 text-caption text-ink-3">{t("findHint")}</p>
      <div aria-live="polite">
        {find.isSuccess && !found && (
          <p className="mt-4 rounded-[16px] bg-raised px-4 py-3 text-small text-ink-2">
            {t("findNobody")}
          </p>
        )}
        {found && (
          <div className="mt-4 rounded-[16px] bg-raised p-3" data-testid="found">
            <FoundRow person={found} onDone={() => find.variables && find.mutate(find.variables)} />
          </div>
        )}
      </div>
    </Card>
  );
}

/** The person found, with the one thing that can be done next: ask, accept their request, or look. */
function FoundRow({ person, onDone }: { person: FoundPerson; onDone: () => void }) {
  const t = useTranslations("friends");
  const send = useSendRequest();
  const action =
    person.relation === "friends" ? (
      <Link
        href={`/friends/${person.userId}`}
        className={buttonStyles({ variant: "secondary", size: "sm" })}
      >
        {t("view")}
      </Link>
    ) : person.relation === "requested" ? (
      <span className="text-small text-ink-3">{t("requested")}</span>
    ) : (
      <Button
        size="sm"
        loading={send.isPending}
        onClick={() => send.mutate(person.userId, { onSuccess: onDone })}
      >
        {person.relation === "incoming" ? t("accept") : t("add")}
      </Button>
    );
  return (
    <PersonRow
      person={person}
      detail={person.relation === "friends" ? t("alreadyFriends") : undefined}
      actions={action}
    />
  );
}

function IncomingCard({ requests }: { requests: FriendEntry[] }) {
  const t = useTranslations("friends");
  const respond = useRespond();
  const busy = (id: string) => respond.isPending && respond.variables?.friendshipId === id;
  return (
    <Card title={t("incomingTitle", { count: requests.length })} testId="incoming">
      <ul className="flex flex-col gap-4">
        {requests.map((r) => (
          <li key={r.friendshipId}>
            <PersonRow
              person={r}
              detail={t("wantsToBeFriends")}
              actions={
                <>
                  <Button
                    size="sm"
                    loading={busy(r.friendshipId) && respond.variables?.accept === true}
                    disabled={busy(r.friendshipId)}
                    onClick={() => respond.mutate({ friendshipId: r.friendshipId, accept: true })}
                  >
                    {t("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy(r.friendshipId)}
                    onClick={() => respond.mutate({ friendshipId: r.friendshipId, accept: false })}
                  >
                    {t("decline")}
                  </Button>
                </>
              }
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FriendsCard({ friends }: { friends: FriendEntry[] }) {
  const t = useTranslations("friends");
  const locale = useLocale();
  const since = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(new Date(iso));
  return (
    <Card
      title={t("friendsTitle")}
      testId="friends"
      aside={
        friends.length > 0 ? (
          <span className="text-small text-ink-3 tnum">{friends.length}</span>
        ) : undefined
      }
    >
      {friends.length === 0 ? (
        <p className="text-body text-ink-2">{t("friendsEmpty")}</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {friends.map((f) => (
            <li key={f.userId}>
              <Link
                href={`/friends/${f.userId}`}
                aria-label={personName(f)}
                className="flex items-center gap-2 rounded-[16px] px-2 py-2.5 transition-colors hover:bg-raised"
              >
                <div className="min-w-0 flex-1">
                  <PersonRow person={f} detail={t("friendsSince", { date: since(f.since) })} />
                </div>
                <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OutgoingCard({ requests }: { requests: FriendEntry[] }) {
  const t = useTranslations("friends");
  const remove = useRemoveFriend();
  const [withdrawing, setWithdrawing] = useState<FriendEntry | null>(null);
  return (
    <Card title={t("outgoingTitle")} testId="outgoing">
      <ul className="flex flex-col gap-4">
        {requests.map((r) => (
          <li key={r.friendshipId}>
            <PersonRow
              person={r}
              detail={t("waiting")}
              actions={
                <Button size="sm" variant="ghost" onClick={() => setWithdrawing(r)}>
                  {t("withdraw")}
                </Button>
              }
            />
          </li>
        ))}
      </ul>
      <ConfirmSheet
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        title={t("withdrawTitle")}
        body={t("withdrawBody", { name: withdrawing ? personName(withdrawing) : "" })}
        confirmLabel={t("withdraw")}
        loading={remove.isPending}
        onConfirm={() =>
          withdrawing &&
          remove.mutate(withdrawing.userId, { onSuccess: () => setWithdrawing(null) })
        }
      />
    </Card>
  );
}
