"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
import { buildFriendActivity, personName, type FriendActivityItem } from "./activity";
import { useFriends, useRecommendations, useRespond } from "./hooks";

/** How many of each kind Home lists before "see all" (the friends page has the rest). */
const SHOWN = 3;

/**
 * On Home, near the top, whenever friends are waiting on me or sent me something: friend requests to answer
 * right here (accept or decline), and wines recommended that I have not seen yet, each with who sent it. Both
 * show together; nothing hides the other. Answering or seeing an item takes it away (the lists refresh). With
 * nothing waiting, nothing is shown.
 */
export function FriendRequestsBanner() {
  const t = useTranslations("friends");
  const friends = useFriends().data;
  const recommendations = useRecommendations().data;
  const respond = useRespond();
  const activity = buildFriendActivity(friends, recommendations);
  if (activity.items.length === 0) return null;
  const invites = activity.items.filter((i) => i.kind === "invite");
  const recs = activity.items.filter((i) => i.kind === "recommendation");
  const name = (item: FriendActivityItem) => personName(item.from) ?? t("someone");
  const total = activity.requests + activity.recommendations;

  return (
    <section
      aria-labelledby="friend-activity-h"
      data-testid="friend-activity"
      className="mt-6 overflow-hidden rounded-card bg-surface shadow-raised ring-1 ring-accent-fg/30"
    >
      <h2
        id="friend-activity-h"
        className="flex items-center gap-2.5 px-5 pt-4 font-display text-title text-ink"
      >
        {t("activityTitle")}
        <span className="grid min-w-7 place-items-center rounded-full bg-accent px-2 py-0.5 text-caption font-semibold text-accent-ink tnum">
          <span className="sr-only">{t("activityCount", { count: total })}</span>
          <span aria-hidden="true">{total}</span>
        </span>
      </h2>

      {invites.length > 0 && (
        <div className="mt-2">
          <Link
            href="/friends"
            data-testid="friend-requests"
            className="flex items-center justify-between gap-3 px-5 py-2 text-small font-medium text-accent-fg"
          >
            {t("entryRequests", { count: activity.requests })}
            <ChevronRightIcon size={18} className="shrink-0" />
          </Link>
          <ul className="divide-y divide-hairline">
            {invites.slice(0, SHOWN).map((item) =>
              item.kind !== "invite" ? null : (
                <li
                  key={item.key}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3"
                >
                  <span className="min-w-0 flex-1 text-body text-ink">
                    {t("activityInvite", { name: name(item) })}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      disabled={respond.isPending}
                      onClick={() =>
                        respond.mutate({ friendshipId: item.friendshipId, accept: true })
                      }
                    >
                      {t("accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={respond.isPending}
                      onClick={() =>
                        respond.mutate({ friendshipId: item.friendshipId, accept: false })
                      }
                    >
                      {t("decline")}
                    </Button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {recs.length > 0 && (
        <Link
          href="/friends#recommendations"
          data-testid="new-recommendations"
          className="mt-1 block border-t border-hairline px-5 py-3 transition-colors duration-150 ease-cellr hover:bg-raised"
        >
          <span className="flex items-center justify-between gap-3 text-small font-medium text-accent-fg">
            {t("entryRecommendations", { count: activity.recommendations })}
            <ChevronRightIcon size={18} className="shrink-0" />
          </span>
          <ul className="mt-1.5 flex flex-col gap-1">
            {recs.slice(0, SHOWN).map((item) =>
              item.kind !== "recommendation" ? null : (
                <li key={item.key} className="truncate text-body text-ink">
                  {t("activityRecommendation", { name: name(item), wine: item.wine })}
                </li>
              ),
            )}
          </ul>
        </Link>
      )}
      <div className="h-2" />
    </section>
  );
}

/** In Profile: the way to Friends, with my account name and anything waiting. */
export function FriendsEntry() {
  const t = useTranslations("friends");
  const { data } = useFriends();
  const unseen = useRecommendations().data?.unseen ?? 0;
  if (data && !data.ready) return null;
  const waiting = (data?.incoming.length ?? 0) + unseen;
  const detail = data
    ? [
        data.me.handle ? `@${data.me.handle}` : null,
        data.incoming.length > 0 ? t("entryRequests", { count: data.incoming.length }) : null,
        unseen > 0 ? t("entryRecommendations", { count: unseen }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || t("entryBody")
    : t("entryBody");
  return (
    <Link
      href="/friends"
      data-testid="friends-entry"
      className="flex items-center justify-between gap-3 rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.99] md:p-6"
    >
      <span className="min-w-0">
        <span className="block font-display text-title">{t("entryTitle")}</span>
        <span className="mt-1 block truncate text-small text-ink-2">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {waiting > 0 && (
          <span className="grid size-7 place-items-center rounded-full bg-accent text-caption font-semibold text-accent-ink tnum">
            {waiting}
          </span>
        )}
        <ChevronRightIcon size={20} className="text-ink-3" />
      </span>
    </Link>
  );
}
