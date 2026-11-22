"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { FriendsView } from "@cellr/domain";
import { api } from "@/lib/api";

/** The name being typed at the end of a draft ("...with @an"), without the @; null when none is. */
export function mentionBeingTyped(draft: string): string | null {
  const match = /(?:^|[^a-z0-9_.@])@([a-z0-9_.]{0,20})$/i.exec(draft);
  return match ? match[1]!.toLowerCase() : null;
}

/** The draft with the name being typed completed to this account name. */
export const completeMention = (draft: string, handle: string): string =>
  draft.replace(/@[a-z0-9_.]{0,20}$/i, `@${handle} `);

/**
 * My friends' account names while I type "@": a help for spelling a name right, nothing more. Picking one writes
 * the name into the question as text; who that is, and whether anything of theirs may be used, is decided by the
 * server when the question is asked.
 */
export function MentionSuggestions({
  draft,
  onPick,
}: {
  draft: string;
  onPick: (handle: string) => void;
}) {
  const t = useTranslations("sommelier");
  const typed = mentionBeingTyped(draft);
  const friends = useQuery({
    queryKey: ["friends"],
    queryFn: () => api.get<FriendsView>("/friends"),
    enabled: typed !== null,
    staleTime: 60_000,
  });
  if (typed === null) return null;
  const names = (friends.data?.friends ?? [])
    .filter((f) => f.status === "accepted" && f.handle)
    .map((f) => f.handle!)
    .filter((handle) => handle.startsWith(typed))
    .slice(0, 5);
  if (names.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t("mentions.label")}
      data-testid="mention-suggestions"
      className="pointer-events-auto mx-auto mb-2 flex max-w-2xl flex-wrap gap-2"
    >
      {names.map((handle) => (
        <button
          key={handle}
          type="button"
          onClick={() => onPick(handle)}
          className="h-9 rounded-full border border-hairline bg-surface px-4 text-small font-medium text-ink-2 shadow-raised hover:text-ink"
        >
          @{handle}
        </button>
      ))}
    </div>
  );
}
