"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRightIcon } from "@/ui/icons";
import { useFriends } from "./hooks";

/** On Home, only when someone is waiting for an answer. */
export function FriendRequestsBanner() {
  const t = useTranslations("friends");
  const incoming = useFriends().data?.incoming.length ?? 0;
  if (incoming === 0) return null;
  return (
    <Link
      href="/friends"
      data-testid="friend-requests"
      className="mt-6 flex items-center justify-between gap-3 rounded-card border border-hairline bg-surface p-5 transition-transform duration-150 ease-cellr active:scale-[0.99]"
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-accent text-small font-semibold text-accent-ink tnum"
        >
          {incoming}
        </span>
        <span className="font-display text-title">{t("entryRequests", { count: incoming })}</span>
      </span>
      <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
    </Link>
  );
}

/** In Profile: the way to Friends, with my account name and anything waiting. */
export function FriendsEntry() {
  const t = useTranslations("friends");
  const { data } = useFriends();
  if (data && !data.ready) return null;
  const incoming = data?.incoming.length ?? 0;
  const detail = data
    ? [
        data.me.handle ? `@${data.me.handle}` : null,
        incoming > 0 ? t("entryRequests", { count: incoming }) : null,
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
        {incoming > 0 && (
          <span className="grid size-7 place-items-center rounded-full bg-accent text-caption font-semibold text-accent-ink tnum">
            {incoming}
          </span>
        )}
        <ChevronRightIcon size={20} className="text-ink-3" />
      </span>
    </Link>
  );
}
