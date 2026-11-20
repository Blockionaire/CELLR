import { notFound } from "next/navigation";
import { parseAdminRange } from "@cellr/domain";
import { adminSommelier, getAdminSession } from "@/server/admin/service";
import {
  Kpi,
  Kpis,
  Notice,
  PageTitle,
  RangeTabs,
  Section,
  Table,
  num,
  pct,
  unavailable,
  usd,
} from "../_ui";

export const dynamic = "force-dynamic";

/**
 * The sommelier, in counts: how answers were given, how they were rated, what came of the bottles they offered and
 * what the model cost. A thumb and an outcome are different things and are shown apart.
 */
export default async function AdminSommelierPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const days = parseAdminRange((await searchParams).days);
  const { report: read, summary: s } = await adminSommelier(session, days);
  const blocked = unavailable(read);
  const report = typeof read === "object" ? read : null;
  return (
    <>
      <PageTitle
        title="Sommelier"
        note="Counts only: no person, household, wine or question. A thumb says the answer was useful; what came of a bottle (opened, had with the dish, how the two went together) is said apart and never derived from a thumb. Questions are the chat's and Tonight's, counted from product events, which a browser with do-not-track does not send: the count is a floor, and the cost per question is therefore an upper bound. UTC days."
      >
        <RangeTabs path="/admin/sommelier" current={days} />
      </PageTitle>
      {blocked || !report || !s ? (
        <Notice>{blocked}</Notice>
      ) : (
        <>
          <Section title={`In ${days} days`}>
            <Kpis>
              <Kpi
                label="Questions"
                value={num(s.questions)}
                hint={`${num(s.byEngines)} answered by the engines, with no model call`}
              />
              <Kpi label="By the engines" value={pct(s.engineShare)} />
              <Kpi
                label="Model cost per question"
                value={usd(s.costPerQuestionUsdMicro)}
                hint={`${usd(report.model.known_cost)} over ${num(report.model.calls)} model calls; ${num(report.model.unknown_calls)} of unknown cost`}
              />
              <Kpi
                label="Model latency"
                value={
                  report.model.avg_latency_ms === null
                    ? "—"
                    : `${num(report.model.avg_latency_ms)} ms`
                }
                hint={
                  report.model.p95_latency_ms === null
                    ? "Successful calls"
                    : `Average of successful calls; 95% within ${num(report.model.p95_latency_ms)} ms`
                }
              />
              <Kpi
                label="Model calls failed"
                value={num(report.model.failed)}
                hint={`${num(report.model.blocked)} blocked by a limit or the budget`}
              />
              <Kpi
                label="Thumbs up"
                value={pct(s.positiveShare)}
                hint={`of ${num(s.rated)} rated answers: the answer was useful`}
              />
              <Kpi
                label="Bottles opened"
                value={num(s.opened)}
                hint={`${num(s.withDish)} had with the dish`}
              />
              <Kpi
                label="Went well together"
                value={pct(s.enjoyedShare)}
                hint={`of ${num(s.enjoyedSaid)} who had the wine with the dish and said how it went`}
              />
            </Kpis>
          </Section>
          <Section
            title="How answers were given"
            note="engine v3: the food and pairing engines decided (no model call). v1: the earlier sommelier. Kind and outcome are the plan's own codes."
          >
            <Table
              caption="Answers by engine, kind and outcome"
              head={[
                { label: "Engine" },
                { label: "Source" },
                { label: "Kind" },
                { label: "Outcome" },
                { label: "Questions", numeric: true },
                { label: "People", numeric: true },
              ]}
              rows={report.answers.map((a) => ({
                key: `${a.engine}|${a.source}|${a.kind}|${a.outcome}`,
                cells: [a.engine, a.source, a.kind, a.outcome, num(a.questions), num(a.people)],
              }))}
            />
          </Section>
          <Section
            title="Ratings of answers"
            note="Whether the answer was useful. Not whether the wine suited the dish."
          >
            <Table
              caption="Ratings by what the answer was"
              head={[
                { label: "Source" },
                { label: "Kind" },
                { label: "Outcome" },
                { label: "Confidence" },
                { label: "Rated", numeric: true },
                { label: "Up", numeric: true },
                { label: "Down", numeric: true },
              ]}
              rows={report.ratings.map((r) => ({
                key: `${r.source}|${r.kind}|${r.outcome}|${r.confidence}`,
                cells: [
                  r.source,
                  r.kind,
                  r.outcome,
                  r.confidence,
                  num(r.answers),
                  num(r.positive),
                  num(r.negative),
                ],
              }))}
            />
          </Section>
          <Section
            title="What came of offered bottles"
            note="Said by the person, bottle by bottle. 'Went well / so-so / not well' only counts those who had the wine with the dish. Small numbers prove nothing: read them as a signal to look, not as a measure of the engine."
          >
            <Table
              caption="Outcomes by what the answer was"
              head={[
                { label: "Kind" },
                { label: "Outcome" },
                { label: "Confidence" },
                { label: "Opened", numeric: true },
                { label: "With the dish", numeric: true },
                { label: "Not with it", numeric: true },
                { label: "Well", numeric: true },
                { label: "So-so", numeric: true },
                { label: "Not well", numeric: true },
              ]}
              rows={report.outcomes.map((o) => ({
                key: `${o.kind}|${o.outcome}|${o.confidence}`,
                cells: [
                  o.kind,
                  o.outcome,
                  o.confidence,
                  num(o.opened),
                  num(o.with_dish),
                  num(o.without_dish),
                  num(o.enjoyed_yes),
                  num(o.enjoyed_mixed),
                  num(o.enjoyed_no),
                ],
              }))}
            />
          </Section>
        </>
      )}
    </>
  );
}
