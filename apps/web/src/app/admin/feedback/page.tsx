import { notFound } from "next/navigation";
import {
  FEEDBACK_CATEGORIES,
  parseAdminPage,
  parseFeedbackCategory,
  type FeedbackCategory,
} from "@cellr/domain";
import { adminFeedback, getAdminSession } from "@/server/admin/service";
import { Kpi, Kpis, Notice, PageTitle, Pager, Section, Tab, Table, date, num } from "../_ui";

export const dynamic = "force-dynamic";

const LABEL: Record<FeedbackCategory, string> = {
  bug: "Bug",
  confusing: "Confusing",
  idea: "Idea",
  other: "Other",
};

const NOT_READY =
  "The beta-feedback database step (supabase/migrations/20261028000020_beta_feedback.sql) has not been run yet.";
const NO_SERVICE_ROLE =
  "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read.";

const href = (category: FeedbackCategory | null, page = 1) => {
  const q = new URLSearchParams();
  if (category) q.set("category", category);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return `/admin/feedback${s ? `?${s}` : ""}`;
};

/**
 * Beta feedback: what testers chose to send from Profile, newest first. Read-only and anonymous here (no names or
 * ids): turning a report into an issue is done by hand. Not analytics: see docs/METRICS.md.
 */
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const category = parseFeedbackCategory(params.category);
  const page = parseAdminPage(params.page);
  const result = await adminFeedback(session, category, page);
  const blocked = result === "missing" ? NOT_READY : result === null ? NO_SERVICE_ROLE : null;
  if (blocked || typeof result !== "object" || !result)
    return (
      <>
        <PageTitle title="Beta feedback" />
        <Notice>{blocked}</Notice>
      </>
    );
  const all = Object.values(result.counts).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageTitle
        title="Beta feedback"
        crumbs={[{ label: "Beta feedback" }]}
        note="Sent by testers from Profile → Share feedback. Only what they typed and chose to include; no names, ids, URLs or diagnostics. Newest first."
      />
      <Section title="By category">
        <Kpis>
          <Kpi label="All" value={num(all)} />
          {FEEDBACK_CATEGORIES.map((c) => (
            <Kpi key={c} label={LABEL[c]} value={num(result.counts[c] ?? 0)} />
          ))}
        </Kpis>
      </Section>
      <nav aria-label="Category" className="mb-4 flex flex-wrap gap-2">
        {[null, ...FEEDBACK_CATEGORIES].map((c) => (
          <Tab key={c ?? "all"} href={href(c)} current={c === category}>
            {c ? LABEL[c] : "All"}
          </Tab>
        ))}
      </nav>
      <Table
        head={[
          { label: "Sent" },
          { label: "Category" },
          { label: "Feedback" },
          { label: "Context" },
        ]}
        rows={result.rows.map((r) => ({
          key: r.id,
          cells: [
            date(r.createdAt),
            LABEL[r.category],
            <p key="m" className="max-w-prose whitespace-pre-wrap">
              {r.message}
            </p>,
            <span key="c" className="block text-caption text-ink-2">
              {[r.location, r.device].filter(Boolean).join(" · ") || "—"}
            </span>,
          ],
        }))}
        empty="No feedback here yet."
      />
      <Pager page={page} pages={result.pages} href={(p) => href(category, p)} />
    </>
  );
}
