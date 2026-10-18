import "server-only";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";
import { getPushEnv } from "@/server/env";
import { logError } from "@/server/log";
import type { FriendNotice } from "@/server/friends/service";
import { sendPush, type PushMessage } from "@/server/push/send";
import { createServiceClient } from "./client";

/**
 * "Someone wants to be your friend" / "… accepted" / "… recommends a wine": a notification on the other person's phones. Their phones are
 * not readable by the sender, so this looks them up with the service role, and only after checking that the
 * request (or friendship) between the two really exists.
 */
export async function sendFriendNotice(notice: FriendNotice): Promise<void> {
  const db = createServiceClient();
  const env = getPushEnv();
  if (!db || !env) return;
  try {
    let wine: { producer: string; wine: string; year: number | null; note: string | null } | null =
      null;
    let real: boolean;
    if (notice.kind === "recommendation") {
      const { data } = await db
        .from("wine_recommendations")
        .select("producer, wine, year, note")
        .eq("id", notice.recommendationId)
        .eq("sender", notice.from)
        .eq("recipient", notice.to)
        .maybeSingle();
      wine = data;
      real = data !== null;
    } else {
      const { data: pair } = await db
        .from("friendships")
        .select("id, requester, addressee, status")
        .or(
          `and(requester.eq.${notice.from},addressee.eq.${notice.to}),and(requester.eq.${notice.to},addressee.eq.${notice.from})`,
        )
        .maybeSingle();
      real =
        notice.kind === "request"
          ? pair?.status === "pending" && pair.requester === notice.from
          : pair?.status === "accepted";
    }
    if (!real) return;

    const [phones, people] = await Promise.all([
      db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", notice.to),
      db
        .from("profiles")
        .select("id, handle, display_name, locale")
        .in("id", [notice.from, notice.to]),
    ]);
    if (phones.error || !phones.data.length) return;
    const sender = people.data?.find((p) => p.id === notice.from);
    const receiver = people.data?.find((p) => p.id === notice.to);
    const locale = receiver?.locale === "nl" ? "nl" : "en";
    const t = createTranslator({
      locale,
      messages: locale === "nl" ? nl : en,
      namespace: "pushMessage",
    });
    const name = sender?.display_name || (sender?.handle ? `@${sender.handle}` : t("someone"));
    const message: PushMessage =
      notice.kind === "recommendation" && wine
        ? {
            title: t("recommendTitle", { name }),
            body: [`${wine.producer} ${wine.wine}${wine.year ? ` ${wine.year}` : ""}`, wine.note]
              .filter(Boolean)
              .join(" — ")
              .slice(0, 180),
            url: "/friends#recommendations",
            tag: `recommend-${notice.recommendationId}`,
          }
        : notice.kind === "request"
          ? {
              title: t("friendRequestTitle", { name }),
              body: t("friendRequestBody"),
              url: "/friends",
              tag: `friend-${notice.from}`,
            }
          : {
              title: t("friendAcceptedTitle", { name }),
              body: t("friendAcceptedBody"),
              url: `/friends/${notice.from}`,
              tag: `friend-${notice.from}`,
            };
    const outcomes = await Promise.all(phones.data.map((p) => sendPush(env, p, message)));
    const gone = phones.data.filter((_, i) => outcomes[i] === "gone").map((p) => p.id);
    if (gone.length > 0) await db.from("push_subscriptions").delete().in("id", gone);
  } catch (e) {
    logError("friend_notice_failed", e);
  }
}
