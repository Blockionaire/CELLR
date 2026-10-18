"use client";

import Link from "next/link";
import { ReservedNote } from "@/features/cellar/reserved-note";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  BUDGET_EUROS,
  BUDGETS,
  ERROR_MESSAGES,
  formatVintage,
  type Budget,
  type BuySuggestion,
  type PairingVerdict,
  type SommelierAnswer,
  type SommelierBottle,
} from "@cellr/domain";
import { placeLine } from "@/features/cellar/wine-visuals";
import { PhasePill, WineStage } from "@/features/tonight/pick-bits";
import { errorMessage } from "@/lib/api";
import { Button, buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { cn } from "@/ui/cn";
import { ChevronRightIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { useAskSommelier } from "./hooks";

const CHIPS = ["tonight", "steak", "peak", "guests", "fish", "keep"] as const;

type Turn =
  | { role: "user"; text: string }
  | { role: "sommelier"; answer: SommelierAnswer }
  | { role: "error"; message: string; retry: string };

/** The words of a turn as the server wants them: only what was said, never what was shown. */
const spoken = (turn: Turn, basic: (a: SommelierAnswer) => string) =>
  turn.role === "user"
    ? { role: "user" as const, text: turn.text }
    : turn.role === "sommelier"
      ? { role: "assistant" as const, text: turn.answer.text ?? basic(turn.answer) }
      : null;

/** The general sommelier: anything about the cellar. */
export function SommelierScreen({ hasBottles }: { hasBottles: boolean }) {
  const t = useTranslations("sommelier");
  return (
    <SommelierChat
      mode="chat"
      title={t("title")}
      subtitle={t("subtitle")}
      chips={CHIPS.map((id) => t(`chips.${id}`))}
      hasBottles={hasBottles}
    />
  );
}

const BUDGET_KEY = "cellr.budget";

const budgetListeners = new Set<() => void>();
const readBudget = (): Budget => {
  try {
    const saved = window.localStorage.getItem(BUDGET_KEY);
    if (saved && (BUDGETS as readonly string[]).includes(saved)) return saved as Budget;
  } catch {
    // storage blocked: the default will do
  }
  return "mid";
};

/** The budget for buying, remembered on this phone; "mid" (€15–30) until chosen. */
function useBudget(): [Budget, (b: Budget) => void] {
  const budget = useSyncExternalStore(
    (l) => {
      budgetListeners.add(l);
      return () => budgetListeners.delete(l);
    },
    readBudget,
    () => "mid" as Budget,
  );
  return [
    budget,
    (b) => {
      try {
        window.localStorage.setItem(BUDGET_KEY, b);
      } catch {
        // only a convenience
      }
      for (const l of budgetListeners) l();
    },
  ];
}

/**
 * A conversation with the sommelier. "tonight" is the same sommelier asked about tonight's dish or evening: it
 * judges the bottles in the cellar honestly, and suggests wines to buy, within the budget, when none fit.
 */
export function SommelierChat({
  mode,
  title,
  subtitle,
  chips,
  hasBottles,
}: {
  mode: "chat" | "tonight";
  title: string;
  subtitle: string;
  /** Tappable starting questions. */
  chips: readonly string[];
  hasBottles: boolean;
}) {
  const t = useTranslations("sommelier");
  const te = useTranslations();
  const ask = useAskSommelier();
  const [budget, setBudget] = useBudget();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // Keep the newest words in view.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, ask.isPending]);

  const basicSentence = (a: SommelierAnswer) => (a.basic ? t(`basic.${a.basic}`) : "");

  async function send(text: string) {
    const question = text.trim();
    if (question === "" || ask.isPending) return;
    const history: Turn[] = [
      ...turns.filter((x) => x.role !== "error"),
      { role: "user", text: question },
    ];
    setTurns([...turns, { role: "user", text: question }]);
    setDraft("");
    const messages = history
      .map((x) => spoken(x, basicSentence))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .slice(-10);
    try {
      const answer = await ask.mutateAsync({
        messages,
        mode,
        budget: mode === "tonight" ? budget : null,
      });
      setTurns((current) => [...current, { role: "sommelier", answer }]);
    } catch (e) {
      setTurns((current) => [
        ...current,
        { role: "error", message: errorMessage(e, (k) => te(k), ERROR_MESSAGES), retry: question },
      ]);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter makes a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  }

  // An empty cellar can still be told what to buy tonight; a general chat about it has nothing to say.
  if (!hasBottles && mode === "chat")
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
              {t("emptyAction")}
            </Link>
          }
        />
      </>
    );

  return (
    <div className="mx-auto w-full max-w-2xl pb-24 lg:pb-0">
      <PageHeader title={title} subtitle={subtitle} />

      <div className="flex flex-col gap-6">
        {turns.length > 0 && (
          <Button variant="ghost" size="sm" className="-mt-3 self-end" onClick={() => setTurns([])}>
            {t("newChat")}
          </Button>
        )}
        {turns.length === 0 && (
          <section aria-labelledby="chips-title">
            <h2
              id="chips-title"
              className="mb-3 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
            >
              {t("tryThese")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {chips.map((label) => (
                <Chip key={label} onClick={() => void send(label)}>
                  {label}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {mode === "tonight" && (
          <section aria-labelledby="budget-title" data-testid="budget">
            <h2
              id="budget-title"
              className="mb-1 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
            >
              {t("budgetTitle")}
            </h2>
            <p className="mb-3 text-small text-ink-3">{t("budgetHint")}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="budget-title">
              {BUDGETS.map((b) => (
                <Chip
                  key={b}
                  role="radio"
                  aria-pressed={undefined}
                  aria-checked={budget === b}
                  selected={budget === b}
                  onClick={() => setBudget(b)}
                >
                  {budgetLabel(b)}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {/* The log is the wrapper: a list that is itself a log would lose its list items. */}
        <div role="log" aria-label={t("conversation")} aria-live="polite">
          <ol className="flex flex-col gap-5">
            {turns.map((turn, i) => (
              <li key={i}>
                {turn.role === "user" && <UserBubble text={turn.text} />}
                {turn.role === "sommelier" && <Answer answer={turn.answer} />}
                {turn.role === "error" && (
                  <div
                    role="alert"
                    className="max-w-[92%] rounded-[22px] rounded-bl-[8px] bg-raised p-4 ring-1 ring-hairline"
                  >
                    <p className="text-body text-ink">
                      {t("failed")} {turn.message}
                    </p>
                    <Button className="mt-3" size="sm" onClick={() => void send(turn.retry)}>
                      {t("retry")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {ask.isPending && (
              <li role="status">
                <span className="inline-flex items-center gap-2.5 rounded-full bg-surface py-2 pl-4 pr-5 text-small text-ink-2 ring-1 ring-hairline">
                  <span aria-hidden="true" className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-accent-fg motion-safe:animate-pulse" />
                    <span className="size-1.5 rounded-full bg-accent-fg motion-safe:animate-pulse [animation-delay:200ms]" />
                    <span className="size-1.5 rounded-full bg-accent-fg motion-safe:animate-pulse [animation-delay:400ms]" />
                  </span>
                  <span className="motion-safe:animate-pulse">{t("thinking")}</span>
                </span>
              </li>
            )}
          </ol>
        </div>
        <div ref={end} className="scroll-mb-44" />

        {/* A pill that floats above the bottom bar; on wide screens it simply follows the conversation. */}
        <form
          onSubmit={submit}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-20 bg-linear-to-t from-canvas via-canvas/90 to-transparent px-5 pb-3 pt-8 lg:sticky lg:bottom-4 lg:bg-none lg:p-0"
        >
          <div className="pointer-events-auto mx-auto flex max-w-2xl items-end gap-2 rounded-[28px] bg-surface p-1.5 pl-5 shadow-raised ring-1 ring-hairline focus-within:ring-accent-fg">
            <textarea
              ref={box}
              aria-label={t("question")}
              placeholder={mode === "tonight" ? t("placeholderTonight") : t("placeholder")}
              rows={1}
              maxLength={800}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              className="max-h-32 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-body text-ink placeholder:text-ink-3 focus-visible:outline-none"
            />
            <Button
              type="submit"
              aria-label={t("send")}
              className="size-11 shrink-0 px-0"
              loading={ask.isPending}
              disabled={draft.trim() === ""}
            >
              <SendIcon />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const budgetLabel = (b: Budget) => {
  const [low, high] = BUDGET_EUROS[b];
  return high === null ? `€${low}+` : low === 0 ? `< €${high}` : `€${low}–${high}`;
};

function SendIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

function UserBubble({ text }: { text: string }) {
  const t = useTranslations("sommelier");
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-[22px] rounded-br-[8px] bg-accent px-4 py-3 text-body text-accent-ink">
        <span className="sr-only">{t("you")}: </span>
        {text}
      </p>
    </div>
  );
}

function Answer({ answer }: { answer: SommelierAnswer }) {
  const t = useTranslations("sommelier");
  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-[92%] rounded-[22px] rounded-bl-[8px] bg-surface px-5 py-4 shadow-raised ring-1 ring-hairline">
        <p
          aria-hidden="true"
          className="mb-1.5 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
        >
          {t("sommelier")}
        </p>
        {answer.verdict && <VerdictBadge verdict={answer.verdict} />}
        <p className="whitespace-pre-wrap font-display text-title text-ink">
          <span className="sr-only">{t("sommelier")}: </span>
          {answer.source === "ai" ? answer.text : answer.basic ? t(`basic.${answer.basic}`) : ""}
        </p>
      </div>
      {answer.bottles.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {answer.bottles.map((b) => (
            <li key={b.vintageId}>
              <BottleCard bottle={b} />
            </li>
          ))}
        </ul>
      )}
      {answer.buy && answer.buy.length > 0 && <BuyList items={answer.buy} />}
      <p className="px-1 text-caption text-ink-3">
        {answer.source === "ai" ? t("aiNote") : answer.reason ? t(`reason.${answer.reason}`) : ""}
      </p>
    </div>
  );
}

function BottleCard({ bottle }: { bottle: SommelierBottle }) {
  const t = useTranslations("sommelier");
  const locale = useLocale();
  const where = placeLine(bottle.region, bottle.countryCode, locale);
  return (
    <Link
      href={`/cellar/${bottle.vintageId}`}
      className="flex items-center gap-3.5 rounded-card bg-surface p-3 shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.98]"
    >
      <WineStage
        type={bottle.type}
        producer={bottle.producer}
        wineName={bottle.wineName}
        year={bottle.year}
        className="h-24 w-[4.5rem] shrink-0"
        bottleClassName="w-7"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
          {bottle.producer}
        </span>
        <span className="block font-display text-title text-ink">{bottle.wineName}</span>
        <span className="block text-small text-ink-2">
          <span className="tnum">{formatVintage(bottle.year)}</span>
          {where && <span> · {where}</span>}
        </span>
        <ReservedNote reserved={bottle.reserved} count={bottle.count} className="mt-1" />
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-ink-3">
          <PhasePill phase={bottle.drinkPhase} />
          <span>{t("bottles", { count: bottle.count })}</span>
          {bottle.places[0] && <span>{bottle.places[0]}</span>}
        </span>
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-ink-3" />
    </Link>
  );
}

const VERDICT_TONE: Record<PairingVerdict, string> = {
  match: "bg-ready-bg text-ready-ink",
  partial: "bg-peak-bg text-peak-ink",
  none: "bg-raised text-ink-2 ring-1 ring-hairline",
};
const VERDICT_DOT: Record<PairingVerdict, string> = {
  match: "bg-ready",
  partial: "bg-peak",
  none: "bg-ink-3",
};

/** How well the cellar answers it, in one honest word or three. */
function VerdictBadge({ verdict }: { verdict: PairingVerdict }) {
  const t = useTranslations("sommelier");
  return (
    <p
      data-testid="verdict"
      className={cn(
        "mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold",
        VERDICT_TONE[verdict],
      )}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", VERDICT_DOT[verdict])} />
      {t(`verdict.${verdict}`)}
    </p>
  );
}

/** Wines worth buying for it: clearly not from the cellar. */
function BuyList({ items }: { items: readonly BuySuggestion[] }) {
  const t = useTranslations("sommelier");
  return (
    <section
      aria-label={t("buyTitle")}
      data-testid="buy"
      className="rounded-card border border-dashed border-hairline bg-canvas p-4"
    >
      <h3 className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
        {t("buyTitle")}
      </h3>
      <p className="mt-1 text-small text-ink-3">{t("buyHint")}</p>
      <ul className="mt-3 flex flex-col divide-y divide-hairline">
        {items.map((b) => (
          <li
            key={b.wine}
            className="flex items-start justify-between gap-3 py-3 first:pt-1 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block font-display text-title text-ink">{b.wine}</span>
              <span className="mt-0.5 block text-small text-ink-2">{b.why}</span>
            </span>
            {b.price && (
              <span className="shrink-0 rounded-full bg-raised px-3 py-1 text-caption font-semibold text-ink tnum">
                {b.price}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
