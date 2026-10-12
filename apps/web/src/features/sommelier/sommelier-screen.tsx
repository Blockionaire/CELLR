"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  type SommelierAnswer,
  type SommelierBottle,
} from "@cellr/domain";
import { PHASE_COLOUR } from "@/features/cellar/drink-bits";
import { placeLine } from "@/features/cellar/wine-visuals";
import { errorMessage } from "@/lib/api";
import { Button, buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
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

export function SommelierScreen({ hasBottles }: { hasBottles: boolean }) {
  const t = useTranslations("sommelier");
  const te = useTranslations();
  const ask = useAskSommelier();
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
      const answer = await ask.mutateAsync({ messages });
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

  if (!hasBottles)
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
    <div className="mx-auto w-full max-w-2xl">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          turns.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setTurns([])}>
              {t("newChat")}
            </Button>
          )
        }
      />

      <div className="flex flex-col gap-6">
        {turns.length === 0 && (
          <section aria-labelledby="chips-title">
            <h2 id="chips-title" className="mb-3 text-small font-medium text-ink-2">
              {t("tryThese")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((id) => (
                <Chip key={id} onClick={() => void send(t(`chips.${id}`))}>
                  {t(`chips.${id}`)}
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
                  <div role="alert" className="rounded-card border border-hairline bg-raised p-4">
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
              <li role="status" className="text-body text-ink-2 motion-safe:animate-pulse">
                {t("thinking")}
              </li>
            )}
          </ol>
        </div>
        <div ref={end} />

        <form
          onSubmit={submit}
          className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+12px)] z-10 flex items-end gap-2 rounded-card border border-hairline bg-surface p-2 shadow-raised lg:bottom-4"
        >
          <textarea
            ref={box}
            aria-label={t("question")}
            placeholder={t("placeholder")}
            rows={1}
            maxLength={800}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-32 min-h-12 flex-1 resize-none bg-transparent px-3 py-3 text-body text-ink placeholder:text-ink-3 focus-visible:outline-none"
          />
          <Button type="submit" size="md" loading={ask.isPending} disabled={draft.trim() === ""}>
            {t("send")}
          </Button>
        </form>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  const t = useTranslations("sommelier");
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-control bg-accent px-4 py-3 text-body text-accent-ink">
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
      <div className="max-w-[92%] rounded-card rounded-bl-control border border-hairline bg-surface px-4 py-3">
        <p className="whitespace-pre-wrap text-body text-ink">
          <span className="sr-only">{t("sommelier")}: </span>
          {answer.source === "ai" ? answer.text : answer.basic ? t(`basic.${answer.basic}`) : ""}
        </p>
      </div>
      {answer.bottles.length > 0 && (
        <ul className="flex flex-col gap-2">
          {answer.bottles.map((b) => (
            <li key={b.vintageId}>
              <BottleCard bottle={b} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-caption text-ink-3">
        {answer.source === "ai" ? t("aiNote") : answer.reason ? t(`reason.${answer.reason}`) : ""}
      </p>
    </div>
  );
}

function BottleCard({ bottle }: { bottle: SommelierBottle }) {
  const t = useTranslations("sommelier");
  const tDrink = useTranslations("drink");
  const locale = useLocale();
  const where = placeLine(bottle.region, bottle.countryCode, locale);
  return (
    <Link
      href={`/cellar/${bottle.vintageId}`}
      className="block rounded-card border border-hairline bg-surface p-4 transition-colors hover:bg-raised active:scale-[0.99]"
    >
      <span className="block truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
        {bottle.producer}
      </span>
      <span className="block font-display text-title text-ink">{bottle.wineName}</span>
      <span className="mt-0.5 block text-small text-ink-2">
        <span className="tnum">{formatVintage(bottle.year)}</span>
        {where && <span> · {where}</span>}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-3">
        <span>{t("bottles", { count: bottle.count })}</span>
        {bottle.places[0] && <span>{bottle.places[0]}</span>}
        {bottle.drinkPhase !== "unknown" && (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: PHASE_COLOUR[bottle.drinkPhase] }}
            />
            {tDrink(`phase.${bottle.drinkPhase}`)}
          </span>
        )}
      </span>
    </Link>
  );
}
