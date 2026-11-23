"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { ReservedNote } from "@/features/cellar/reserved-note";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  annotationEmphasis,
  BUDGET_EUROS,
  BUDGETS,
  ERROR_MESSAGES,
  formatVintage,
  type BottleAnnotation,
  type Budget,
  type BuySuggestion,
  type PairingVerdict,
  type SommelierAnswer,
  type SommelierBottle,
  type SommelierConversationView,
  type SommelierRating,
} from "@cellr/domain";
import { placeLine } from "@/features/cellar/wine-visuals";
import { PhasePill } from "@/features/tonight/pick-bits";
import { WinePicture } from "@/features/cellar/wine-picture";
import { errorMessage } from "@/lib/api";
import { Button, buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { plainSentence } from "./plain-sentence";
import { PlanView } from "./plan-view";
import { buyPriceLabel, checkNote, checkSentence } from "./check-sentence";
import { AnnotationView } from "./annotation-view";
import { QuantityView } from "./quantity-view";
import { cn } from "@/ui/cn";
import { ChevronRightIcon, ScanIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import {
  CHAT_KEY,
  updateChat,
  useAskSommelier,
  useChat,
  useChatAsking,
  useNewConversation,
  useRateAnswer,
} from "./hooks";
import { chatExpired, EMPTY_CHAT, newQuestionId, spoken, type ChatState, type Turn } from "./turns";

const CHIPS = ["tonight", "steak", "peak", "guests", "fish", "keep"] as const;
/** Questions that lean on the person's own taste (shown while it is in use). */
const PERSONAL_CHIPS = ["love", "new", "match"] as const;
/** With no bottles yet, the questions that still have an answer: about the cellar itself. */
const EMPTY_CHIPS = ["bottles", "space"] as const;
/** On a phone, this many example questions show; the rest wait behind "More ideas". */
const SHOWN_ON_PHONE = 2;

/** The general sommelier: anything about the cellar. Its conversation is kept (see sommelier-conversation.ts). */
export function SommelierScreen({
  hasBottles,
  conversation,
}: {
  hasBottles: boolean;
  /** The kept conversation, read with the page; left out when it could not be, and the screen reads it itself. */
  conversation?: SommelierConversationView | undefined;
}) {
  const t = useTranslations("sommelier");
  return (
    <SommelierChat
      mode="chat"
      title={t("title")}
      subtitle={t("subtitle")}
      chips={CHIPS.map((id) => t(`chips.${id}`))}
      hasBottles={hasBottles}
      conversation={conversation}
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
 *
 * The general chat ("chat") is kept: in the query cache while the app is open (so it is there again after a wine
 * page, with a question still on its way), and on the server for 7 days (so it is there again after the app was
 * closed). Coming back only shows it: nothing is asked again. Tonight's conversation stays on this screen.
 */
export function SommelierChat({
  mode,
  title,
  subtitle,
  chips,
  hasBottles,
  initialQuestion,
  conversation,
}: {
  mode: "chat" | "tonight";
  title: string;
  subtitle: string;
  /** Tappable starting questions. */
  chips: readonly string[];
  hasBottles: boolean;
  /** A question asked from elsewhere (Home's "steak tonight"): asked at once, as if typed here. */
  initialQuestion?: string | undefined;
  /** The general chat's kept conversation, as the page read it. */
  conversation?: SommelierConversationView | undefined;
}) {
  const t = useTranslations("sommelier");
  const te = useTranslations();
  const toast = useToast();
  const client = useQueryClient();
  const ask = useAskSommelier(mode);
  const [budget, setBudget] = useBudget();
  const kept = mode === "chat";
  const chat = useChat(kept, conversation);
  const [localTurns, setLocalTurns] = useState<Turn[]>(() =>
    initialQuestion ? [{ role: "user", text: initialQuestion }] : [],
  );
  const turns = kept ? (chat.data?.turns ?? []) : localTurns;
  /** Always from the latest turns: an answer that arrives after the screen was left still lands in the kept chat. */
  const setTurns = (update: (current: Turn[]) => Turn[]) =>
    kept
      ? updateChat(client, (state) => ({ ...state, turns: update(state.turns) }))
      : setLocalTurns(update);
  /** The kept chat as it stands now; a copy older than its 7 days is let go first (an app left open that long). */
  const liveTurns = () => {
    if (!kept) return turns;
    if (!chatExpired(client.getQueryData<ChatState>(CHAT_KEY), Date.now())) return turns;
    updateChat(client, () => EMPTY_CHAT);
    return [];
  };
  // A kept question may still be on its way from before the screen was left: it counts as asking, so it is never
  // asked twice and the conversation cannot be cleared under it.
  const askingKept = useChatAsking();
  const pending = kept ? askingKept : ask.isPending;
  // Only when the page could not bring the conversation along: it is being read, and nothing is asked meanwhile.
  const restoring = kept && chat.isPending;
  const reset = useNewConversation();
  // Set at once (the pending state shows a render later): a double tap cannot send the same question twice.
  const sending = useRef(false);
  const [draft, setDraft] = useState("");
  // The person's own taste is used unless they ask for general advice (for this conversation only).
  const [personal, setPersonal] = useState(true);
  const [moreIdeas, setMoreIdeas] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // Opened again after the kept conversation's 7 days (the app stayed open): its old copy goes, unseen and unsent.
  useEffect(() => {
    if (kept && !pending) liveTurns();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only
  }, []);

  // Keep the newest words in view.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns.length, pending]);

  // What an answer without words of its own says: the plain answer's sentence, or, for an AI answer whose words the
  // check replaced (V1+ `check`), the sentence made from its cards. It is also what goes along as the chat so far.
  const basicSentence = (a: SommelierAnswer) => unworded(a, t);

  async function send(text: string) {
    const question = text.trim();
    if (question === "" || pending || restoring || sending.current) return;
    // In the kept chat the question gets its id here, so sending it again can never keep it twice.
    const asked = { role: "user", text: question, id: kept ? newQuestionId() : undefined } as const;
    const history: Turn[] = [...liveTurns().filter((x) => x.role !== "error"), asked];
    setTurns((current) => [...current, asked]);
    setDraft("");
    await answer(history, asked);
  }

  /** Asks about the conversation so far (ending in the person's question) and adds the answer. */
  async function answer(history: Turn[], asked: { text: string; id?: string | undefined }) {
    const messages = history
      .map((x) => spoken(x, basicSentence))
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .slice(-10);
    sending.current = true;
    try {
      // What the conversation has established so far, as the last answer's plan returned it (Sommelier 3.0).
      // Only when the sommelier's latest answer was a plan: a state from before an ordinary answer or an error
      // is stale, and is not sent.
      const latest = history.findLast((x) => x.role === "sommelier");
      const lastPlan = latest?.role === "sommelier" ? latest.answer.plan : null;
      const { saved, ...reply } = await ask.mutateAsync({
        messages,
        ...(lastPlan ? { state: lastPlan.state } : {}),
        mode,
        budget: mode === "tonight" ? budget : null,
        personal,
        ...(asked.id ? { questionId: asked.id } : {}),
      });
      setTurns((current) => [
        ...current,
        {
          role: "sommelier",
          answer: reply,
          ...(saved ? { id: saved.messageId, rating: null } : {}),
        },
      ]);
      // Kept: its 7 days start again from this question.
      if (kept && saved) updateChat(client, (state) => ({ ...state, lastAskedAt: Date.now() }));
    } catch (e) {
      setTurns((current) => [
        ...current,
        {
          role: "error",
          message: errorMessage(e, (k) => te(k), ERROR_MESSAGES),
          retry: asked.text,
          questionId: asked.id,
        },
      ]);
    } finally {
      sending.current = false;
    }
  }

  /**
   * Tries a failed question again. In the kept chat it is the same question (the same id: had it reached the
   * server after all, its kept answer comes back, without a second call), moved to the end; Tonight asks anew.
   */
  function retry(failed: Extract<Turn, { role: "error" }>) {
    const id = failed.questionId;
    if (!kept || !id) return void send(failed.retry);
    if (pending || restoring || sending.current) return;
    const asked = { role: "user", text: failed.retry, id } as const;
    const others = (list: Turn[]) =>
      list.filter((x) => x !== failed && !(x.role === "user" && x.id === id));
    const before = others(liveTurns()).filter((x) => x.role !== "error");
    setTurns((current) => [...others(current), asked]);
    void answer([...before, asked], asked);
  }

  /** A new conversation: in the kept chat the old one is deleted first, so it is never sent to the model again. */
  function startOver() {
    if (!kept) return setLocalTurns([]);
    reset.mutate(undefined, {
      onError: () => toast.show(t("newChatFailed"), { tone: "error" }),
    });
  }

  // Asked from Home: the question is already on screen (see the initial state); fetch its answer once, and
  // take it out of the address so a reload does not ask again.
  const askedFirst = useRef(false);
  useEffect(() => {
    if (!initialQuestion || askedFirst.current) return;
    askedFirst.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void answer([{ role: "user", text: initialQuestion }], { text: initialQuestion });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

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

  // An empty cellar: no wine advice yet, but questions about the cellar itself (how many bottles, how much room)
  // still have true answers, so the chat stays, with an invitation to add the first bottle and factual examples.
  const empty = !hasBottles && mode === "chat";
  const examples = empty
    ? EMPTY_CHIPS.map((id) => t(`emptyChips.${id}`))
    : [
        ...(mode === "chat" && personal
          ? PERSONAL_CHIPS.map((id) => t(`personalChips.${id}`))
          : []),
        ...chips,
      ];
  // The general sommelier with more questions than fit on a phone: the rest go behind "More ideas" there.
  // (Tonight keeps its own row of dishes, which starts with the most common ones.)
  const compact = mode === "chat" && examples.length > SHOWN_ON_PHONE;

  return (
    <div className="mx-auto w-full max-w-2xl pb-24 lg:pb-0">
      <PageHeader title={title} subtitle={subtitle} />

      <div className="flex flex-col gap-6">
        {turns.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="-mt-3 self-end"
            onClick={startOver}
            disabled={pending}
            loading={reset.isPending}
          >
            {t("newChat")}
          </Button>
        )}
        {mode === "chat" && turns.length === 0 && !restoring && <PurchaseCheckEntry />}
        {empty && turns.length === 0 && !restoring && (
          <EmptyState
            title={t("emptyTitle")}
            body={t("emptyBody")}
            action={
              <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        )}
        {turns.length === 0 && !restoring && (
          <section aria-labelledby="chips-title" data-testid="example-questions">
            <h2
              id="chips-title"
              className="mb-3 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
            >
              {t("tryThese")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {examples.map((label, i) => (
                <Chip
                  key={label}
                  // On a phone only the first few show: the rest are one tap away, so the screen stays the chat's.
                  className={compact && i >= SHOWN_ON_PHONE ? "max-sm:hidden" : undefined}
                  onClick={() => void send(label)}
                >
                  {label}
                </Chip>
              ))}
              {compact && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setMoreIdeas(true)}
                  data-testid="more-ideas"
                  className="h-9 px-2 text-small font-medium text-accent-fg underline-offset-4 hover:underline sm:hidden"
                >
                  {t("moreIdeas", { count: examples.length - SHOWN_ON_PHONE })}
                </button>
              )}
            </div>
            {compact && (
              <Sheet
                open={moreIdeas}
                onClose={() => setMoreIdeas(false)}
                title={t("moreIdeasTitle")}
              >
                <div className="flex flex-wrap gap-2 pb-2" data-testid="more-ideas-list">
                  {examples.slice(SHOWN_ON_PHONE).map((label) => (
                    <Chip
                      key={label}
                      onClick={() => {
                        setMoreIdeas(false);
                        void send(label);
                      }}
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
              </Sheet>
            )}
          </section>
        )}

        {!empty && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <Chip
              selected={personal}
              onClick={() => setPersonal(!personal)}
              data-testid="use-taste"
            >
              {t("taste.use")}
            </Chip>
            {/* A way to the profile, so a button of its own; quieter than the taste toggle beside it. Its touch
                area reaches beyond the pill to 44px high. */}
            <Link
              href="/taste-profile"
              data-testid="taste-profile"
              className={buttonStyles({
                variant: "secondary",
                size: "sm",
                className:
                  "gap-1 pr-3 after:absolute after:inset-x-0 after:-inset-y-1 after:rounded-full",
              })}
            >
              {t("taste.profile")}
              <ChevronRightIcon size={16} className="text-ink-3" />
            </Link>
          </div>
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
                {turn.role === "sommelier" && (
                  <Answer
                    answer={turn.answer}
                    // What the question before it asked about the wines (how to serve, how long to keep): the
                    // cards show that first.
                    emphasis={emphasisOf(turns[i - 1])}
                    // A quick answer belongs to the last question asked back, not to an older one.
                    onReply={turn === turns.at(-1) ? (text) => void send(text) : undefined}
                    feedback={
                      kept && turn.id ? (
                        <AnswerFeedback messageId={turn.id} rating={turn.rating ?? null} />
                      ) : null
                    }
                  />
                )}
                {turn.role === "error" && (
                  <div
                    role="alert"
                    className="max-w-[92%] rounded-[22px] rounded-bl-[8px] bg-raised p-4 ring-1 ring-hairline"
                  >
                    <p className="text-body text-ink">
                      {t("failed")} {turn.message}
                    </p>
                    <Button className="mt-3" size="sm" onClick={() => retry(turn)}>
                      {t("retry")}
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {pending && (
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
              loading={pending}
              disabled={draft.trim() === "" || restoring}
            >
              <SendIcon />
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The sentence of an answer that has no words of its own (see `basicSentence`). */
const unworded = (a: SommelierAnswer, t: Parameters<typeof plainSentence>[1]) =>
  a.source === "ai" ? checkSentence(a, t) : plainSentence(a, t);
/** What the question before an answer asked about its wines, for the cards' facts (see annotationEmphasis). */
const emphasisOf = (turn: Turn | undefined) =>
  turn?.role === "user" ? annotationEmphasis(turn.text) : null;

const budgetLabel = (b: Budget) => {
  const [low, high] = BUDGET_EUROS[b];
  return high === null ? `€${low}+` : low === 0 ? `< €${high}` : `€${low}–${high}`;
};

/** The way into the Koopcheck: photograph a bottle in a shop and see whether it is worth buying. */
function PurchaseCheckEntry() {
  const t = useTranslations("purchaseCheck");
  return (
    <Link
      href="/sommelier/purchase-check"
      data-testid="purchase-check-entry"
      className="group flex items-center gap-4 rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.99]"
    >
      <span
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-full bg-accent/10 text-accent-fg"
      >
        <ScanIcon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-title leading-snug text-ink">
          {t("entryTitle")}
        </span>
        <span className="mt-0.5 block text-small text-ink-2">{t("entryBody")}</span>
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-ink-3" />
    </Link>
  );
}

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

/**
 * An answer arrives in its parts, one after the other: the sommelier's words, then the bottles it points at,
 * then what to buy. Each part is shown as soon as it is there (nothing is held back to look like typing).
 */
function Answer({
  answer,
  emphasis = null,
  feedback,
  onReply,
}: {
  answer: SommelierAnswer;
  emphasis?: "serving" | "keeping" | null;
  feedback?: ReactNode;
  onReply?: ((text: string) => void) | undefined;
}) {
  const t = useTranslations("sommelier");
  let i = 0;
  const note = checkNote(answer.check, t);
  // Sommelier V1+ (`annotate`, `quantities`): the app's own facts for the cards, when the answer carries them.
  const annotationOf = (vintageId: string) =>
    answer.annotations?.find((a) => a.vintageId === vintageId) ?? null;
  const card = (bottle: SommelierBottle, first: boolean) => (
    <BottleCard
      bottle={bottle}
      first={first}
      annotation={annotationOf(bottle.vintageId)}
      emphasis={emphasis}
    />
  );
  const quantity = answer.quantity ? (
    <QuantityView
      quantity={answer.quantity}
      nameOf={(vintageId) => {
        const bottle = answer.bottles.find((b) => b.vintageId === vintageId);
        return bottle ? `${bottle.producer} ${bottle.wineName}` : null;
      }}
    />
  ) : null;
  // Sommelier 3.0: the engines' plan is drawn as it is; nothing below it is a model's wording.
  if (answer.plan)
    return (
      <div className="flex flex-col gap-3">
        {answer.personal && (
          <p className="px-1 text-caption font-medium text-accent-fg" data-testid="personal">
            {t("taste.used")}
          </p>
        )}
        <PlanView
          plan={answer.plan}
          bottles={[...answer.bottles, ...(answer.otherBottles ?? [])]}
          card={card}
          onReply={onReply}
        />
        {quantity}
        <div className="flex items-center justify-end gap-3 px-1">{feedback}</div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <div
        className="reveal max-w-[92%] rounded-[22px] rounded-bl-[8px] bg-surface px-5 py-4 shadow-raised ring-1 ring-hairline"
        style={{ "--i": i++ } as React.CSSProperties}
      >
        <p
          aria-hidden="true"
          className="mb-1.5 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
        >
          {t("sommelier")}
        </p>
        {answer.personal && (
          <p className="mb-1.5 text-caption font-medium text-accent-fg" data-testid="personal">
            {t("taste.used")}
          </p>
        )}
        {answer.verdict && <VerdictBadge verdict={answer.verdict} />}
        <p className="whitespace-pre-wrap font-display text-title text-ink">
          <span className="sr-only">{t("sommelier")}: </span>
          {answer.text ?? unworded(answer, t)}
        </p>
        {note && (
          <p className="mt-2 text-caption text-ink-3" data-testid="check-note">
            {note}
          </p>
        )}
      </div>
      {answer.bottles.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {answer.bottles.map((b, n) => (
            <li
              key={b.vintageId}
              className="reveal"
              style={{ "--i": i++ + 1 } as React.CSSProperties}
            >
              {card(b, n === 0)}
            </li>
          ))}
        </ul>
      )}
      {quantity && (
        <div className="reveal" style={{ "--i": i++ + 1 } as React.CSSProperties}>
          {quantity}
        </div>
      )}
      {answer.buy && answer.buy.length > 0 && (
        <div className="reveal" style={{ "--i": i++ + 2 } as React.CSSProperties}>
          <BuyList items={answer.buy} checked={answer.check !== undefined} />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-caption text-ink-3">
          {answer.source === "ai" ? t("aiNote") : answer.reason ? t(`reason.${answer.reason}`) : ""}
        </p>
        {feedback}
      </div>
    </div>
  );
}

/**
 * Was this answer useful? Two quiet thumbs under a kept answer: one tap chooses, a tap on the chosen one takes it
 * back, a tap on the other changes it. No questions asked. The choice shows at once and is kept with the answer.
 */
function AnswerFeedback({
  messageId,
  rating,
}: {
  messageId: string;
  rating: SommelierRating | null;
}) {
  const t = useTranslations("sommelier");
  const toast = useToast();
  const rate = useRateAnswer(messageId, () => toast.show(t("feedback.failed"), { tone: "error" }));
  const choose = (value: SommelierRating) =>
    rate.mutate({ messageId, rating: rating === value ? null : value });
  return (
    <div
      role="group"
      aria-label={t("feedback.label")}
      data-testid="answer-feedback"
      className="-my-2 -mr-2 flex shrink-0 items-center"
    >
      <RateButton
        icon={ThumbsUp}
        label={t("feedback.positive")}
        pressed={rating === "positive"}
        onClick={() => choose("positive")}
      />
      <RateButton
        icon={ThumbsDown}
        label={t("feedback.negative")}
        pressed={rating === "negative"}
        onClick={() => choose("negative")}
      />
    </div>
  );
}

function RateButton({
  icon: Icon,
  label,
  pressed,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "grid size-10 place-items-center rounded-full transition-[color,background-color,transform] duration-150 ease-cellr hover:bg-raised active:scale-90",
        pressed ? "text-accent-fg" : "text-ink-3 hover:text-ink-2",
      )}
    >
      <Icon
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        fill={pressed ? "currentColor" : "none"}
        fillOpacity={pressed ? 0.2 : undefined}
      />
    </button>
  );
}

/**
 * A bottle from the cellar the sommelier points at: the wine as itself (its label photo when there is one),
 * where it is, and the way from the advice to the glass — "take this bottle" opens it on its own page.
 */
function BottleCard({
  bottle,
  first,
  annotation = null,
  emphasis = null,
}: {
  bottle: SommelierBottle;
  first: boolean;
  annotation?: BottleAnnotation | null;
  emphasis?: "serving" | "keeping" | null;
}) {
  const t = useTranslations("sommelier");
  const locale = useLocale();
  const where = placeLine(bottle.region, bottle.countryCode, locale);
  return (
    <article className="relative flex gap-4 rounded-card bg-surface p-3 pr-4 shadow-raised ring-1 ring-hairline">
      <WinePicture
        wine={{ ...bottle, image: bottle.image ?? null }}
        className="h-28 w-[4.75rem] shrink-0 rounded-[14px]"
        bottleClassName="h-[84%]"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-bronze">
          {bottle.producer}
        </p>
        <h3 className="font-display text-title leading-snug text-ink">
          <Link href={`/cellar/${bottle.vintageId}`} className="after:absolute after:inset-0">
            {bottle.wineName}
          </Link>
        </h3>
        <p className="text-small text-ink-2">
          <span className="tnum">{formatVintage(bottle.year)}</span>
          {where && <span> · {where}</span>}
        </p>
        <ReservedNote reserved={bottle.reserved} count={bottle.count} className="mt-1" />
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-ink-2">
          <PhasePill phase={bottle.drinkPhase} />
          <span className="inline-flex items-center gap-1">
            <PinIcon />
            {bottle.places[0] ?? t("noPlace")}
          </span>
          <span>{t("bottles", { count: bottle.count })}</span>
        </p>
        {annotation && (
          <div className="mt-2 border-t border-hairline pt-2">
            <AnnotationView annotation={annotation} emphasis={emphasis} />
          </div>
        )}
        <Link
          href={`/cellar/${bottle.vintageId}?pick=1`}
          className={buttonStyles({
            variant: first ? "primary" : "secondary",
            size: "sm",
            className: "relative z-10 mt-3 self-start",
          })}
        >
          {t("takeThis")}
          <ChevronRightIcon size={16} />
        </Link>
      </div>
    </article>
  );
}

function PinIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="text-bronze"
    >
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
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
function BuyList({ items, checked }: { items: readonly BuySuggestion[]; checked: boolean }) {
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
      <p className="mt-1 text-small text-ink-3">{t(checked ? "check.buyHint" : "buyHint")}</p>
      {/* A checked answer never shows the model's price: the person's own budget once, or that none is known. */}
      {checked && items[0] && (
        <p
          className="mt-2 inline-block rounded-full bg-raised px-3 py-1 text-caption font-semibold text-ink tnum"
          data-testid="buy-price"
        >
          {buyPriceLabel(items[0], t)}
        </p>
      )}
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
            {!checked && b.price && (
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
