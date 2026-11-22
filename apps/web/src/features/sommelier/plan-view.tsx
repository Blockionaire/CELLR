"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { PlanPick, SommelierBottle, SommelierPlan } from "@cellr/domain";

/** The quick answers offered with a question back, by question. The words are in the messages. */
const QUICK = {
  budget: ["budget.a", "budget.b", "budget.c", "budget.d"],
  channel: ["channel.a", "channel.b"],
  "location-consent": ["location-consent.a", "location-consent.b"],
  "recipient-taste": ["recipient-taste.a", "recipient-taste.b", "recipient-taste.c"],
  dish: [],
  occasion: [],
} as const;

const wineName = (b: SommelierBottle) =>
  `${b.producer} ${b.wineName}${b.year === null ? "" : ` ${b.year}`}`;

/**
 * SOMMELIER 3.0'S ANSWER, DRAWN FROM THE PLAN. Everything here is what the engines decided: the outcome, the
 * bottles with the reasons for and against each, what was set aside and why, what to buy as a kind of wine, real
 * offers only when a source confirmed them, and one question back. No sentence is a model's: each is a fixed
 * wording of a code, so the screen can never say more than the plan does.
 */
export function PlanView({
  plan,
  bottles,
  card,
  onReply,
}: {
  plan: SommelierPlan;
  bottles: readonly SommelierBottle[];
  /** How a bottle is drawn (the chat's own card). */
  card: (bottle: SommelierBottle, first: boolean) => ReactNode;
  /** Sends a quick answer as the person's next message; absent for an answer that is no longer the last. */
  onReply?: ((text: string) => void) | undefined;
}) {
  const t = useTranslations("sommelier");
  const format = useFormatter();
  const bottleOf = new Map(bottles.map((b) => [b.vintageId, b]));
  const offered = plan.picks.flatMap((p) => {
    const bottle = bottleOf.get(p.vintageId);
    return bottle ? [{ pick: p, bottle }] : [];
  });
  const closest = plan.closest ? bottleOf.get(plan.closest.vintageId) : undefined;
  // One thing is said once: a question back is the whole message when nothing else was decided.
  const headline =
    plan.kind === "clarify"
      ? plan.ask === "dish"
        ? null
        : t("plan.outcome.clarify")
      : plan.outcome === null
        ? null
        : plan.outcome === "none" && plan.considered === 0
          ? t("plan.outcome.noneEmpty")
          : t(`plan.outcome.${plan.outcome}`);
  const quick = plan.ask ? QUICK[plan.ask] : [];

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="plan"
      data-outcome={plan.outcome ?? plan.kind}
    >
      <div className="max-w-[92%] rounded-[22px] rounded-bl-[8px] bg-surface px-5 py-4 shadow-raised ring-1 ring-hairline">
        <p
          aria-hidden="true"
          className="mb-1.5 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
        >
          {t("sommelier")}
        </p>
        {plan.dish && plan.kind !== "clarify" && (
          <p className="mb-1 text-caption font-medium text-ink-3" data-testid="plan-dish">
            {t("plan.dish", { dish: plan.dish })}
          </p>
        )}
        {headline && (
          <p className="font-display text-title text-ink" data-testid="plan-headline">
            <span className="sr-only">{t("sommelier")}: </span>
            {headline}
          </p>
        )}
        {plan.confidence && offered.length > 0 && (
          <p className="mt-2 text-small text-ink-3" data-testid="plan-confidence">
            {t(`plan.confidence.${plan.confidence}`)}
          </p>
        )}
        {plan.ask && (
          <p className="mt-3 font-display text-title text-ink" data-testid="plan-ask">
            {t(`plan.ask.${plan.ask}`)}
          </p>
        )}
      </div>

      {plan.friends.length > 0 && (
        <ul className="flex flex-col gap-0.5 px-1 text-small text-ink-3" data-testid="plan-friends">
          {plan.friends.map((f) => (
            <li key={f.handle}>
              <span className="font-medium text-ink-2">@{f.handle}</span>
              {": "}
              {t(`plan.friend.${f.status}`)}
            </li>
          ))}
        </ul>
      )}

      {offered.length > 0 && (
        <ul className="flex flex-col gap-2.5" data-testid="plan-picks">
          {offered.map(({ pick, bottle }, n) => (
            <li key={pick.vintageId} className="flex flex-col gap-1.5">
              {card(bottle, n === 0)}
              <Reasons pick={pick} />
            </li>
          ))}
        </ul>
      )}

      {plan.closest && closest && (
        <section className="flex flex-col gap-1.5" data-testid="plan-closest">
          <p className="px-1 text-small text-ink-2">{t("plan.closest")}</p>
          {card(closest, false)}
          <Reasons pick={plan.closest} />
        </section>
      )}

      {plan.setAside.length > 0 && (
        <section
          aria-label={t("plan.aside.title")}
          data-testid="plan-aside"
          className="rounded-card bg-raised px-4 py-3"
        >
          <h3 className="text-caption font-medium uppercase tracking-[0.14em] text-ink-3">
            {t("plan.aside.title")}
          </h3>
          <ul className="mt-1.5 flex flex-col gap-1 text-small text-ink-2">
            {plan.setAside.map((s) => {
              const bottle = bottleOf.get(s.vintageId);
              return bottle ? (
                <li key={s.vintageId}>
                  <span className="font-medium text-ink">{wineName(bottle)}</span>
                  {": "}
                  {t(`plan.aside.${s.reason}`)}
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}

      {(plan.styles.length > 0 || plan.offers.length > 0) && (
        <section
          aria-label={t("plan.buy.title")}
          data-testid="plan-buy"
          className="rounded-card border border-dashed border-hairline bg-canvas p-4"
        >
          <h3 className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {t("plan.buy.title")}
          </h3>
          {plan.styles.length > 0 && (
            <>
              <p className="mt-1 text-small text-ink-3">{t("plan.buy.hint")}</p>
              <ul className="mt-3 flex flex-col divide-y divide-hairline">
                {plan.styles.map((s) => (
                  <li
                    key={s.styleId}
                    data-testid="plan-style"
                    className="flex items-start justify-between gap-3 py-3 first:pt-1 last:pb-0"
                  >
                    <span className="min-w-0">
                      <span className="block font-display text-title text-ink">{s.label}</span>
                      <span className="mt-0.5 block text-small text-ink-2">
                        {s.pros.length > 0
                          ? s.pros.map((p) => t(`plan.pro.${p}`)).join("; ")
                          : t(`plan.buy.reason.${s.reason}`)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-raised px-3 py-1 text-caption font-medium text-ink-2 tnum">
                      {t("plan.buy.from", { euros: s.fromEuros })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {plan.offerCheck !== "not-asked" && (
            <p className="mt-3 text-small text-ink-3" data-testid="plan-offer-check">
              {t(`plan.offerCheck.${plan.offerCheck}`)}
            </p>
          )}
          {plan.offers.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {plan.offers.map((o, n) => (
                <li
                  key={`${n}-${o.url}`}
                  data-testid="plan-offer"
                  className="rounded-card bg-surface p-3 ring-1 ring-hairline"
                >
                  <p className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
                    {t(`plan.offer.${o.level}`)}
                  </p>
                  <p className="mt-0.5 font-display text-title text-ink">
                    {o.producer} {o.name}
                    {o.year === null ? "" : ` ${o.year}`}
                  </p>
                  <p className="mt-0.5 text-small text-ink-2">
                    <span className="font-semibold text-ink tnum">
                      {format.number(o.priceCents / 100, {
                        style: "currency",
                        currency: o.currency,
                      })}
                    </span>{" "}
                    {t("plan.offer.at", { merchant: o.store ?? o.merchant })} ·{" "}
                    {t("plan.offer.seen", { when: format.relativeTime(new Date(o.observedAt)) })}
                  </p>
                  {/* Only ever a shop's own https page; anything else is not a link. */}
                  {o.url.startsWith("https://") && (
                    <a
                      href={o.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-1 inline-block text-small font-medium text-accent-fg underline underline-offset-2"
                    >
                      {t("plan.offer.open")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {plan.ask && onReply && quick.length > 0 && (
        <div
          role="group"
          aria-label={t("plan.quickLabel")}
          data-testid="plan-quick"
          className="flex flex-wrap items-center gap-2"
        >
          {quick.map((option) => {
            const label = t(`plan.quick.${option}`);
            // An action, not a toggle: a plain button, so it is not announced as "pressed".
            return (
              <button
                key={option}
                type="button"
                onClick={() => onReply(label)}
                className="h-9 shrink-0 rounded-full border border-hairline bg-surface px-4 text-small font-medium text-ink-2 transition-colors duration-150 ease-cellr hover:text-ink active:scale-[0.97]"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Why a bottle suits, what to keep in mind, and what the inventory says about it. */
function Reasons({ pick }: { pick: PlanPick }) {
  const t = useTranslations("sommelier");
  if (pick.pros.length + pick.cons.length + pick.notes.length === 0) return null;
  return (
    <div className="px-1 text-small text-ink-2" data-testid="plan-reasons">
      {pick.pros.length > 0 && (
        <p>
          <span className="font-medium text-ink">{t("plan.why")}: </span>
          {pick.pros.map((p) => t(`plan.pro.${p}`)).join("; ")}.
        </p>
      )}
      {pick.cons.length > 0 && (
        <p>
          <span className="font-medium text-ink">{t("plan.but")}: </span>
          {pick.cons.map((c) => t(`plan.con.${c}`)).join("; ")}.
        </p>
      )}
      {pick.notes.map((note) => (
        <p key={note} className="text-ink-3">
          {t(`plan.note.${note}`)}
        </p>
      ))}
    </div>
  );
}
