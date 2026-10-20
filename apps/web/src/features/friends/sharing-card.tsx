"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  DEFAULT_SHARING,
  SHARE_ITEMS,
  type FriendEntry,
  type ShareItem,
  type ShareMode,
  type SharingView,
} from "@cellr/domain";
import { Button } from "@/ui/button";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { useSaveSharing, useSharing } from "./hooks";
import { Card, FriendCheck } from "./person";

const EMPTY: SharingView = {
  modes: DEFAULT_SHARING,
  picks: { ratings: [], taste: [], cellar: [] },
};

const same = (a: SharingView, b: SharingView) =>
  SHARE_ITEMS.every(
    (i) =>
      a.modes[i] === b.modes[i] &&
      (a.modes[i] !== "chosen" || [...a.picks[i]].sort().join() === [...b.picks[i]].sort().join()),
  );

/** For each of ratings, taste profile and cellar: all my friends, nobody, or the friends I tick. */
export function SharingCard({
  initial,
  friends,
}: {
  initial: SharingView | null;
  friends: FriendEntry[];
}) {
  const t = useTranslations("friends");
  const tc = useTranslations("common");
  const sharing = useSharing(initial);
  const saved = sharing.data ?? initial ?? EMPTY;
  const save = useSaveSharing();
  const [draft, setDraft] = useState<SharingView | null>(null);
  const view = draft ?? saved;
  const dirty = draft !== null && !same(draft, saved);

  const setMode = (item: ShareItem, mode: ShareMode) =>
    setDraft({ ...view, modes: { ...view.modes, [item]: mode } });
  const toggle = (item: ShareItem, friendId: string) => {
    const picked = view.picks[item].includes(friendId);
    setDraft({
      ...view,
      picks: {
        ...view.picks,
        [item]: picked
          ? view.picks[item].filter((id) => id !== friendId)
          : [...view.picks[item], friendId],
      },
    });
  };

  const modes = [
    { value: "friends" as const, label: t("modeFriends") },
    { value: "chosen" as const, label: t("modeChosen") },
    { value: "none" as const, label: t("modeNone") },
  ];

  // Not knowing what is shared is said as such: the defaults are not shown as if they were the saved choice.
  if (!sharing.data && !initial) {
    return (
      <Card title={t("sharingTitle")} testId="sharing">
        {sharing.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="text-small text-ink-2">{t("sharingFailed")}</p>
            <Button size="sm" variant="secondary" onClick={() => void sharing.refetch()}>
              {tc("retry")}
            </Button>
          </div>
        ) : (
          <Skeleton className="h-40 rounded-card" />
        )}
      </Card>
    );
  }

  return (
    <Card title={t("sharingTitle")} testId="sharing">
      <p className="-mt-2 mb-5 text-small text-ink-2">{t("sharingBody")}</p>
      <div className="flex flex-col gap-6">
        {SHARE_ITEMS.map((item) => (
          <div key={item} data-testid={`share-${item}`}>
            <h3 className="text-body font-medium text-ink">{t(`share.${item}.title`)}</h3>
            <p className="mb-3 text-small text-ink-3">{t(`share.${item}.body`)}</p>
            <Segmented
              label={t(`share.${item}.title`)}
              options={modes}
              value={view.modes[item]}
              onChange={(m) => setMode(item, m)}
              className="flex w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-2"
            />
            {view.modes[item] === "chosen" &&
              (friends.length === 0 ? (
                <p className="mt-3 text-small text-ink-3">{t("chooseNoFriends")}</p>
              ) : (
                <ul
                  className="mt-3 flex flex-col gap-1"
                  aria-label={t("chooseLabel", { what: t(`share.${item}.title`) })}
                >
                  {friends.map((f) => {
                    const on = view.picks[item].includes(f.userId);
                    return (
                      <li key={f.userId}>
                        <FriendCheck
                          friend={f}
                          checked={on}
                          onChange={() => toggle(item, f.userId)}
                        />
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        ))}
      </div>
      {dirty && (
        <div className="mt-6 flex gap-2">
          <Button
            loading={save.isPending}
            onClick={() => draft && save.mutate(draft, { onSuccess: () => setDraft(null) })}
          >
            {tc("save")}
          </Button>
          <Button variant="ghost" onClick={() => setDraft(null)}>
            {tc("cancel")}
          </Button>
        </div>
      )}
    </Card>
  );
}
