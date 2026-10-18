import "server-only";
import { createTranslator } from "next-intl";
import { dueNotices, noticeKey, type DrinkNotice, type DrinkNoticeKind } from "@cellr/domain";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";
import { createCellarRepository } from "@/server/cellar/repository";
import { toNoticeWines } from "@/server/cellar/service";
import { isMissingTable } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import { getPushEnv } from "@/server/env";
import { createInsightsRepository } from "@/server/insights/repository";
import { logError } from "@/server/log";
import { sendPush, type PushMessage } from "@/server/push/send";
import { createServiceClient } from "./client";

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * The daily round: for everyone who switched reminders on, which wine in their (active) cellar reached its best
 * years or its last stretch since yesterday, told once, in one notification per person. Runs with the service
 * role because it looks at every person; it only ever reads their own cellar for them.
 */
export async function runDrinkReminders(
  now = new Date(),
): Promise<{ people: number; notified: number; skipped?: string }> {
  const db = createServiceClient();
  const env = getPushEnv();
  if (!db || !env) return { people: 0, notified: 0, skipped: "not configured" };

  const subs = await allRows((a, b) =>
    db
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .order("id")
      .range(a, b),
  );
  if (subs.error && isMissingTable(subs.error))
    return { people: 0, notified: 0, skipped: "database step missing" };
  if (subs.error) throw subs.error;

  const byUser = new Map<string, Subscription[]>();
  for (const s of subs.data) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  const cellars = createCellarRepository(db);
  const insights = createInsightsRepository(db);
  let notified = 0;

  for (const [userId, phones] of byUser) {
    try {
      const { data: profile } = await db
        .from("profiles")
        .select("locale, active_household_id")
        .eq("id", userId)
        .maybeSingle();
      const householdId = profile?.active_household_id;
      if (!householdId) continue;
      // Still a member? (A household one has left is not one's cellar any more.)
      const { count } = await db
        .from("household_members")
        .select("user_id", { count: "exact", head: true })
        .eq("household_id", householdId)
        .eq("user_id", userId);
      if (!count) continue;

      const [rows, windows, sent] = await Promise.all([
        cellars.listInventory(householdId),
        insights.listWindows(householdId),
        allRows((a, b) =>
          db
            .from("drink_notices")
            .select("vintage_id, kind")
            .eq("user_id", userId)
            .order("vintage_id")
            .range(a, b),
        ),
      ]);
      // Without knowing what was told before, nothing is told: never the same reminder twice.
      if (sent.error) throw sent.error;
      const ai = new Map(
        (windows ?? []).map((w) => [w.vintageId, { from: w.from, until: w.until }]),
      );
      const wines = toNoticeWines(
        rows.map((r) => ({ ...r, aiWindow: ai.get(r.vintageId) ?? null })),
        now,
      );
      const known = new Set(
        sent.data.map((r) => noticeKey(r.vintage_id, r.kind as DrinkNoticeKind)),
      );
      const { announce, quiet } = dueNotices(wines, known, now);
      const remember = async (notices: DrinkNotice[]) => {
        if (notices.length === 0) return;
        await db.from("drink_notices").upsert(
          notices.map((n) => ({ user_id: userId, vintage_id: n.vintageId, kind: n.kind })),
          { onConflict: "user_id,vintage_id,kind", ignoreDuplicates: true },
        );
      };
      await remember(quiet);
      if (announce.length === 0) continue;

      const message = compose(profile?.locale === "nl" ? "nl" : "en", announce);
      const outcomes = await Promise.all(phones.map((p) => sendPush(env, p, message)));
      const gone = phones.filter((_, i) => outcomes[i] === "gone").map((p) => p.id);
      if (gone.length > 0) await db.from("push_subscriptions").delete().in("id", gone);
      // Only what reached at least one phone counts as told; otherwise it is tried again tomorrow.
      if (outcomes.includes("sent")) {
        await remember(announce);
        notified += 1;
      }
    } catch (e) {
      logError("drink_reminders_person_failed", e);
    }
  }
  return { people: byUser.size, notified };
}

/** One notification per person: the wine itself when it is one, a short list when there are more. */
export function compose(locale: "en" | "nl", notices: DrinkNotice[]): PushMessage {
  const t = createTranslator({
    locale,
    messages: locale === "nl" ? nl : en,
    namespace: "pushMessage",
  });
  if (notices.length === 1) {
    const n = notices[0]!;
    return {
      title:
        n.kind === "peak" ? t("peakTitle", { wine: n.title }) : t("endingTitle", { wine: n.title }),
      body: n.kind === "peak" ? t("peakBody") : t("endingBody"),
      url: `/cellar/${n.vintageId}`,
      tag: `drink-${n.vintageId}`,
    };
  }
  return {
    title: t("manyTitle", { count: notices.length }),
    body: t("manyBody", { wines: notices.map((n) => n.title).join(" · ") }),
    url: "/",
    tag: "drink-reminders",
  };
}
