import { notFound } from "next/navigation";
import { adminReviews, getAdminSession } from "@/server/admin/service";
import { Message, Notice, PageTitle, Pill, Section, date, input, small, smallDanger } from "../_ui";
import { moderateReviewAction } from "./actions";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Community review moderation: reviews with open reports, hidden ones first (three reports of people who use CELLR
 * hide a review until a moderator decides). Every decision needs a reason and is logged.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const queue = await adminReviews.queue(session);
  const title = <PageTitle title="Community reviews" crumbs={[{ label: "Community reviews" }]} />;
  if (queue === "missing" || queue === null)
    return (
      <>
        {title}
        <Notice>
          {queue === "missing"
            ? "The database step for this page (supabase/migrations/20261130000052_community_reviews.sql) has not been run yet."
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  return (
    <>
      {title}
      <Message text={first(params.msg) ?? null} />
      <Section
        title="Reported reviews"
        note="Hidden reviews first, then by number of open reports."
      >
        {queue.length === 0 ? (
          <Notice>No review has open reports.</Notice>
        ) : (
          <ul className="flex flex-col gap-4">
            {queue.map((q) => (
              <li key={q.reviewId} className="rounded-card bg-surface p-4 ring-1 ring-hairline">
                <div className="flex flex-wrap items-center gap-2 text-small">
                  <Pill
                    tone={
                      q.status === "hidden" ? "warn" : q.status === "removed" ? "danger" : "neutral"
                    }
                  >
                    {q.status}
                  </Pill>
                  <span>
                    {(q.score / 2).toFixed(1)}★ · {q.vintage ?? "NV"} · {q.openReports} open report
                    {q.openReports === 1 ? "" : "s"} ({q.reasons.join(", ")}) · published{" "}
                    {date(q.publishedAt)}
                  </span>
                </div>
                <p className="mt-2 text-small font-medium text-ink">{q.wine ?? "(wine unknown)"}</p>
                <p className="mt-2 whitespace-pre-line text-body text-ink">
                  {q.body ?? "(no text)"}
                </p>
                <form
                  action={moderateReviewAction}
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="reviewId" value={q.reviewId} />
                  <input
                    aria-label="Reason (logged)"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="Reason (logged)"
                    className={input}
                  />
                  <button name="action" value="restore" className={small}>
                    Restore
                  </button>
                  <button name="action" value="hide" className={small}>
                    Hide
                  </button>
                  <button name="action" value="remove" className={smallDanger}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
