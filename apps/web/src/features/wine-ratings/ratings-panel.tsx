"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  ERROR_MESSAGES,
  REPORT_REASONS,
  REVIEW_BODY_MAX,
  selectRatings,
  starRowOf,
  starRows,
  type CommunityReview,
  type MyReview,
  type ReportReason,
  type ReviewFilter,
  type VintageFilter,
  type WineRatingsData,
} from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { Sheet } from "@/ui/sheet";
import { Stars } from "@/ui/stars";
import { Textarea } from "@/ui/textarea";
import { useToast } from "@/ui/toast";

/**
 * THE RATINGS BLOCK of a wine page or a catalogue record page (docs/sprints/ratings/DESIGN.md §5).
 *
 * Honesty rules, all enforced here or below:
 * - The CELLR score is computed by the domain (`selectRatings` → `ratingScore`) from real numbers; nothing is
 *   invented. With no ratings at all the block says so and shows no number.
 * - Counts are always the real counts (external and CELLR separately), never weighted.
 * - The source is not named on the card (owner's permission: one central credit); "How we score" links to the
 *   page that names it and explains the method.
 * - A wine without a catalogue identity has no block at all: there is nothing honest to show.
 */

export type RatingsSubject = { kind: "wine"; id: string } | { kind: "record"; id: string };

export interface MyTasting {
  id: string;
  score: number | null;
  year: number | null;
}

export function useRatings(subject: RatingsSubject, enabled: boolean) {
  return useQuery({
    queryKey: ["ratings", subject.kind, subject.id],
    queryFn: () =>
      api.get<WineRatingsData>(
        subject.kind === "wine"
          ? `/wines/${subject.id}/ratings`
          : `/catalog/records/${subject.id}/ratings`,
      ),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

const vintageKey = (v: VintageFilter) => String(v);

export function RatingsPanel({
  subject,
  enabled,
  currentYear,
  myTastings = [],
  communityEnabled = false,
}: {
  subject: RatingsSubject;
  enabled: boolean;
  /** The vintage the page is about (undefined on a record page: all vintages first). */
  currentYear?: number | null | undefined;
  /** The reader's own scored tastings of this wine, to offer publishing one. */
  myTastings?: MyTasting[];
  communityEnabled?: boolean;
}) {
  const t = useTranslations("ratingsPanel");
  const locale = useLocale();
  const ratings = useRatings(subject, enabled);
  const initialVintage: VintageFilter =
    currentYear === undefined ? "all" : currentYear === null ? "nv" : currentYear;
  const [vintage, setVintage] = useState<VintageFilter>(initialVintage);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [reporting, setReporting] = useState<CommunityReview | null>(null);

  const data = ratings.data;
  const selection = useMemo(
    () => (data ? selectRatings(data, vintage, reviewFilter) : null),
    [data, vintage, reviewFilter],
  );
  if (enabled && ratings.isPending)
    return <div aria-hidden="true" className="my-8 h-56 animate-pulse rounded-card bg-raised" />;
  if (!enabled || !data || !data.available || !selection) return null;

  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat(locale);
  const { score } = selection;
  const total = score.external.count + score.cellr.count;
  const rows = starRows(
    selection.externalDistribution.map((n, i) => n + (selection.cellrDistribution[i] ?? 0)),
  );
  const maxRow = Math.max(1, ...rows);
  const vintageLabel = (v: VintageFilter) =>
    v === "all" ? t("allVintages") : v === "nv" ? t("nv") : String(v);
  const years: VintageFilter[] = [
    "all",
    ...data.vintages.map((v) => (v.year === null ? ("nv" as const) : v.year)),
  ];
  if (!years.some((y) => vintageKey(y) === vintageKey(initialVintage)))
    years.splice(1, 0, initialVintage);
  const shownReviews = selection.reviews.filter(
    (r) => starFilter === null || starRowOf(r.score) === starFilter,
  );
  const publishable = myTastings.filter(
    (x) =>
      x.score !== null &&
      (vintage === "all" || (vintage === "nv" ? x.year === null : x.year === vintage)),
  );
  const canPublish = communityEnabled && data.reviewable && publishable.length > 0;

  return (
    <section
      aria-labelledby="ratings-heading"
      data-testid="ratings-panel"
      className="border-t border-hairline py-8"
    >
      <div className="mb-4 flex min-h-9 items-center justify-between gap-3">
        <h2 id="ratings-heading" className="font-serif text-title text-ink">
          {t("title")}
        </h2>
        <Link
          href="/about/ratings"
          className="text-small text-accent-fg underline-offset-4 hover:underline"
        >
          {t("howWeScore")}
        </Link>
      </div>

      {/* vintage filter: the page's vintage first; "all" pools them exactly */}
      {years.length > 2 && (
        <div
          role="group"
          aria-label={t("vintageFilter")}
          className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
        >
          {years.map((y) => (
            <Chip
              key={vintageKey(y)}
              selected={vintageKey(y) === vintageKey(vintage)}
              aria-pressed={vintageKey(y) === vintageKey(vintage)}
              onClick={() => {
                setVintage(y);
                setStarFilter(null);
              }}
              className="shrink-0"
            >
              {vintageLabel(y)}
            </Chip>
          ))}
        </div>
      )}

      {score.combined === null ? (
        <div
          className="rounded-card bg-surface p-5 text-center ring-1 ring-hairline"
          data-testid="ratings-empty"
        >
          <p className="font-serif text-title text-ink">{t("emptyTitle")}</p>
          <p className="mt-1 text-small text-ink-2">
            {vintage === "all"
              ? t("emptyBodyAll")
              : t("emptyBody", {
                  vintage: vintage === "nv" ? t("thisNv") : t("theYear", { year: String(vintage) }),
                })}
          </p>
          {canPublish && (
            <Button className="mt-4" size="sm" onClick={() => setPublishing(true)}>
              {t("beFirst")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* the CELLR score: prominent, with the real number of ratings behind it */}
          <div className="flex items-center gap-4 rounded-card bg-surface p-5 ring-1 ring-hairline">
            <div className="flex flex-col items-center">
              <span
                className="font-serif text-[2.75rem] leading-none text-accent-fg tnum"
                data-testid="cellr-score"
              >
                {one.format(score.combined)}
              </span>
              <span className="mt-1 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-bronze">
                {t("cellrScore")}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <Stars
                score={score.combined * 2}
                size={20}
                label={t("starsLabel", { value: one.format(score.combined) })}
              />
              <p className="mt-1.5 text-small text-ink-2" data-testid="ratings-total">
                {t("basedOn", { count: total, formatted: whole.format(total) })}
              </p>
            </div>
          </div>

          {/* the two averages, separately, with their real counts */}
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <Tile
              label={t("external")}
              average={score.external.average}
              count={score.external.count}
              format={one}
              whole={whole}
              t={t}
            />
            <Tile
              label={t("community")}
              average={score.cellr.average}
              count={score.cellr.count}
              format={one}
              whole={whole}
              t={t}
              accent
            />
          </dl>

          {/* the distribution; with community reviews on, a row filters the reviews to that many stars */}
          <div className="mt-5" role="group" aria-label={t("distribution")}>
            {[5, 4, 3, 2, 1].map((star) => {
              const n = rows[star - 1] ?? 0;
              const pressed = starFilter === star;
              const label = t("rowLabel", { star, count: n, formatted: whole.format(n) });
              const inner = (
                <>
                  <span className="text-small text-ink-2 tnum">{star}★</span>
                  <span className="h-2 overflow-hidden rounded-full bg-raised ring-1 ring-hairline">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.round((n / maxRow) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right text-small text-ink-2 tnum">{whole.format(n)}</span>
                </>
              );
              const grid =
                "grid min-h-11 w-full grid-cols-[2.25rem_1fr_3.5rem] items-center gap-3 rounded-md px-1 py-1.5 text-left";
              return communityEnabled ? (
                <button
                  key={star}
                  type="button"
                  aria-pressed={pressed}
                  aria-label={label}
                  onClick={() => setStarFilter(pressed ? null : star)}
                  disabled={n === 0}
                  className={cn(
                    grid,
                    "transition-colors hover:bg-raised disabled:opacity-50",
                    pressed && "bg-raised",
                  )}
                >
                  {inner}
                </button>
              ) : (
                <div key={star} className={grid} role="img" aria-label={label}>
                  {inner}
                </div>
              );
            })}
          </div>
        </>
      )}

      {communityEnabled && (
        <div className="mt-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-serif text-body-lg text-ink">{t("reviewsTitle")}</h3>
            {canPublish && score.combined !== null && (
              <Button size="sm" variant="secondary" onClick={() => setPublishing(true)}>
                {data.reviews.some(
                  (r) =>
                    r.mine && (vintage === "all" || r.year === (vintage === "nv" ? null : vintage)),
                )
                  ? t("edit")
                  : t("share")}
              </Button>
            )}
          </div>
          <div role="group" aria-label={t("reviewFilter")} className="mb-3 flex flex-wrap gap-2">
            {(["all", "with_text", "mine"] as const).map((f) => (
              <Chip
                key={f}
                selected={reviewFilter === f}
                aria-pressed={reviewFilter === f}
                onClick={() => setReviewFilter(f)}
              >
                {t(`filter.${f}`)}
              </Chip>
            ))}
            {starFilter !== null && (
              <Chip
                selected
                aria-pressed={undefined}
                onClick={() => setStarFilter(null)}
                aria-label={t("clearStars")}
              >
                {t("starsChip", { star: starFilter })} ×
              </Chip>
            )}
          </div>
          {shownReviews.length === 0 ? (
            <p className="rounded-card bg-surface p-4 text-small text-ink-2 ring-1 ring-hairline">
              {reviewFilter === "mine"
                ? t("noneMine")
                : starFilter !== null
                  ? t("noneStars", { star: starFilter })
                  : t("noneYet")}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline" data-testid="reviews">
              {shownReviews.map((r) => (
                <ReviewItem
                  key={r.id}
                  review={r}
                  subject={subject}
                  onReport={() => setReporting(r)}
                />
              ))}
            </ul>
          )}
          <p className="mt-3 text-[0.75rem] text-ink-3">{t("weightNote")}</p>
        </div>
      )}

      {publishing && (
        <PublishSheet
          tastings={publishable}
          subject={subject}
          onClose={() => setPublishing(false)}
        />
      )}
      {reporting && <ReportSheet review={reporting} onClose={() => setReporting(null)} />}
    </section>
  );
}

function Tile({
  label,
  average,
  count,
  format,
  whole,
  t,
  accent = false,
}: {
  label: string;
  average: number | null;
  count: number;
  format: Intl.NumberFormat;
  whole: Intl.NumberFormat;
  t: ReturnType<typeof useTranslations<"ratingsPanel">>;
  accent?: boolean;
}) {
  return (
    <div className="rounded-card bg-surface p-3.5 ring-1 ring-hairline">
      <dt className={cn("text-[0.75rem] font-medium", accent ? "text-accent-fg" : "text-ink-2")}>
        {label}
      </dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="font-serif text-title text-ink tnum">
          {average === null ? "–" : format.format(average)}
        </span>
        <span className="text-small text-ink-3">
          {t("count", { count, formatted: whole.format(count) })}
        </span>
      </dd>
    </div>
  );
}

function ReviewItem({
  review,
  subject,
  onReport,
}: {
  review: CommunityReview;
  subject: RatingsSubject;
  onReport: () => void;
}) {
  const t = useTranslations("ratingsPanel");
  const te = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/reviews/${review.id}`),
    onSuccess: () => {
      toast.show(t("removed"));
      void qc.invalidateQueries({ queryKey: ["ratings", subject.kind, subject.id] });
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
  const [confirming, setConfirming] = useState(false);
  const stars = review.score / 2;
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(review.tastedOn));
  return (
    <li className="py-3.5 first:pt-0" data-testid="review">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Stars
          score={review.score}
          size={14}
          label={t("starsLabel", {
            value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(stars),
          })}
        />
        <span className="text-small font-medium text-ink">{review.author ?? t("member")}</span>
        {review.mine && (
          <span className="rounded-full bg-raised px-2 py-0.5 text-[0.6875rem] text-ink-2">
            {t("you")}
          </span>
        )}
        <span className="text-[0.75rem] text-ink-3">
          · {review.year === null ? t("nv") : review.year} · {date}
          {review.edited ? ` · ${t("edited")}` : ""}
        </span>
      </div>
      {review.body && (
        <p className="mt-1.5 whitespace-pre-line break-words text-body text-ink-2">{review.body}</p>
      )}
      <div className="mt-1 flex gap-2">
        {review.mine ? (
          confirming ? (
            <>
              <button
                type="button"
                className="-mx-2 min-h-11 px-2 text-small font-medium text-danger"
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                {t("removeConfirm")}
              </button>
              <button
                type="button"
                className="min-h-11 px-2 text-small text-ink-2"
                onClick={() => setConfirming(false)}
              >
                {t("keep")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="-mx-2 min-h-11 px-2 text-small text-danger"
              onClick={() => setConfirming(true)}
            >
              {t("remove")}
            </button>
          )
        ) : (
          <button
            type="button"
            className="-mx-2 min-h-11 px-2 text-small text-ink-2"
            onClick={onReport}
          >
            {t("report")}
          </button>
        )}
      </div>
    </li>
  );
}

function PublishSheet({
  tastings,
  subject,
  onClose,
}: {
  tastings: MyTasting[];
  subject: RatingsSubject;
  onClose: () => void;
}) {
  const t = useTranslations("ratingsPanel");
  const te = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const [tastingId, setTastingId] = useState(tastings[0]?.id ?? "");
  const [body, setBody] = useState("");
  const [consent, setConsent] = useState(false);
  // the person's existing review of this tasting: its text is loaded, so publishing again never wipes it
  const mine = useQuery({
    queryKey: ["my-review", tastingId],
    queryFn: () => api.get<{ review: MyReview }>(`/tastings/${tastingId}/review`),
    enabled: tastingId !== "",
    staleTime: 0,
    retry: false,
  });
  const existing = mine.data?.review ?? null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = tastingId !== "" && mine.isPending;
  if (mine.data && loadedFor !== tastingId) {
    setLoadedFor(tastingId);
    setBody(existing?.body ?? "");
  }
  const [error, setError] = useState<string | null>(null);
  const chosen = tastings.find((x) => x.id === tastingId) ?? tastings[0];
  const publish = useMutation({
    mutationFn: () =>
      api.put<{ status: string }>(`/tastings/${tastingId}/review`, { body, consent: true }),
    onSuccess: (r) => {
      toast.show(r.status === "updated" ? t("updated") : t("published"));
      void qc.invalidateQueries({ queryKey: ["ratings", subject.kind, subject.id] });
      void qc.invalidateQueries({ queryKey: ["my-review"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES)),
  });
  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? t("editTitle") : t("publishTitle")}
      description={t("publishBody")}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (consent && chosen) publish.mutate();
        }}
      >
        {tastings.length > 1 && (
          <div role="group" aria-label={t("whichTasting")} className="flex flex-wrap gap-2">
            {tastings.map((x) => (
              <Chip key={x.id} selected={x.id === tastingId} onClick={() => setTastingId(x.id)}>
                {x.year ?? t("nv")} ·{" "}
                {new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                  (x.score ?? 0) / 2,
                )}
                ★
              </Chip>
            ))}
          </div>
        )}
        {chosen?.score != null && (
          <p className="flex items-center gap-2 text-small text-ink-2">
            <Stars score={chosen.score} size={16} label={t("yourScore")} /> {t("scoreFromTasting")}
          </p>
        )}
        <Textarea
          disabled={loading}
          label={t("bodyLabel")}
          value={body}
          maxLength={REVIEW_BODY_MAX}
          rows={4}
          placeholder={t("bodyPlaceholder")}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="-mt-2 text-right text-[0.75rem] text-ink-3 tnum">
          {body.length}/{REVIEW_BODY_MAX}
        </p>
        <label className="flex items-start gap-3 text-small text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5 size-5 accent-[var(--accent)]"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{t("consent")}</span>
        </label>
        <p className="text-[0.75rem] text-ink-3">{t("privateStays")}</p>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          block
          disabled={!consent || !chosen || mine.isPending}
          loading={publish.isPending}
        >
          {existing ? t("saveChanges") : t("publish")}
        </Button>
      </form>
    </Sheet>
  );
}

function ReportSheet({ review, onClose }: { review: CommunityReview; onClose: () => void }) {
  const t = useTranslations("ratingsPanel");
  const te = useTranslations();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const send = useMutation({
    mutationFn: () => api.post(`/reviews/${review.id}/report`, { reason }),
    onSuccess: () => {
      toast.show(t("reported"));
      onClose();
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
  return (
    <Sheet open onClose={onClose} title={t("reportTitle")} description={t("reportBody")}>
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label={t("reportTitle")} className="flex flex-wrap gap-2">
          {REPORT_REASONS.map((r) => (
            <Chip
              key={r}
              role="radio"
              aria-checked={reason === r}
              aria-pressed={undefined}
              selected={reason === r}
              onClick={() => setReason(r)}
            >
              {t(`reason.${r}`)}
            </Chip>
          ))}
        </div>
        <Button
          block
          disabled={reason === null}
          loading={send.isPending}
          onClick={() => send.mutate()}
        >
          {t("sendReport")}
        </Button>
      </div>
    </Sheet>
  );
}
