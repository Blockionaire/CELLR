import { notFound } from "next/navigation";
import { parseAdminRange } from "@cellr/domain";
import { adminAi, getAdminSession } from "@/server/admin/service";
import {
  DayBars,
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

export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const days = parseAdminRange((await searchParams).days);
  const data = await adminAi(session, days);
  const blocked = unavailable(data.range);
  const range = typeof data.range === "object" ? data.range : null;
  const s = data.summary;
  const budget = typeof data.budget === "object" ? data.budget : null;
  return (
    <>
      <PageTitle
        title="AI & costs"
        note="Estimated from recorded token usage and the versioned price list: not OpenAI invoices. A call whose cost is unknown (no usage reported) is counted apart, never as free. UTC days."
      >
        <RangeTabs path="/admin/ai" current={days} />
      </PageTitle>
      {blocked || !range || !s ? (
        <Notice>{blocked}</Notice>
      ) : (
        <>
          <Section title="Estimated spend">
            <Kpis>
              <Kpi
                label="Today"
                value={usd(data.today?.knownCostUsdMicro)}
                hint={unknownHint(data.today)}
              />
              <Kpi
                label="Last 7 days"
                value={usd(data.week?.knownCostUsdMicro)}
                hint={unknownHint(data.week)}
              />
              <Kpi
                label="This month"
                value={usd(data.month?.knownCostUsdMicro)}
                hint={unknownHint(data.month)}
              />
              <Kpi
                label={`Unknown cost, ${days} days`}
                value={num(s.unknownCostCalls)}
                hint={`calls · ${usd(s.unknownHeldUsdMicro)} held for them by the budget`}
              />
            </Kpis>
            <div className="mt-4">
              <p className="mb-2 text-caption text-ink-2">Estimated spend per day (known costs)</p>
              <DayBars
                label="Estimated spend per day"
                days={range.by_day.map((d) => ({ day: d.day, value: d.known_cost }))}
                format={(n) => usd(n)}
              />
            </div>
          </Section>
          <Section
            title={`Calls, ${days} days`}
            note="Rates are over calls that reached the provider; calls the budget blocked never did."
          >
            <Kpis>
              <Kpi
                label="Calls"
                value={num(s.calls)}
                hint={`${num(s.blocked)} blocked by the budget`}
              />
              <Kpi label="Succeeded" value={pct(s.successRate)} />
              <Kpi
                label="Failed"
                value={pct(s.failureRate)}
                hint="Errors, invalid output, provider rate limits"
              />
              <Kpi label="Timed out" value={pct(s.timeoutRate)} />
              <Kpi
                label="Average latency"
                value={s.avgLatencyMs === null ? "—" : `${num(s.avgLatencyMs)} ms`}
                hint="Successful calls"
              />
              <Kpi
                label="Tokens in / out"
                value={`${compact(s.tokensIn)} / ${compact(s.tokensOut)}`}
                hint={`${compact(s.tokensCachedIn)} cached input`}
              />
              <Kpi
                label="Web searches"
                value={num(s.webSearches)}
                hint={`${usd(s.searchFeesUsdMicro)} in call fees ($10 / 1 000); search content is inside input tokens`}
              />
            </Kpis>
          </Section>
          <Section
            title={`Recognition cache, ${days} days`}
            note="An identical photo this household confirmed before is recognised without the vision model. Only the very same processed image matches; other photos of the same bottle do not."
          >
            {data.cache ? (
              <Kpis>
                <Kpi label="Vision calls avoided" value={num(data.cache.visionCallsAvoided)} />
                <Kpi label="Cache hits" value={num(data.cache.hits)} />
                <Kpi label="Cache misses" value={num(data.cache.misses)} hint="Read by the model" />
                <Kpi label="Hit rate" value={pct(data.cache.hitRate)} hint="Of scans that looked" />
              </Kpis>
            ) : (
              <p className="text-body text-ink-2">
                Not available yet: run 20261029000021_recognition_cache.sql.
              </p>
            )}
          </Section>
          <Section
            title={`Shared wine profiles, ${days} days`}
            note="A wine profile researched once for a catalogue wine is reused by other households for the same vintage and language. A household's own wines always keep a private profile and are not counted here."
          >
            {data.shared ? (
              <Kpis>
                <Kpi label="Research calls avoided" value={num(data.shared.researchCallsAvoided)} />
                <Kpi
                  label="Research calls made"
                  value={data.shared.researchCalls === null ? "—" : num(data.shared.researchCalls)}
                  hint="wine_insight, all wines"
                />
                <Kpi label="Cache hits" value={num(data.shared.hits)} />
                <Kpi label="Cache misses" value={num(data.shared.misses)} hint="Researched" />
                <Kpi label="Hit rate" value={pct(data.shared.hitRate)} hint="Of catalogue wines" />
                <Kpi
                  label="Shared profiles"
                  value={num(data.shared.sharedProfiles)}
                  hint={`${num(data.shared.reviewDue)} older than 12 months (review; never refreshed by themselves)`}
                />
              </Kpis>
            ) : (
              <p className="text-body text-ink-2">
                Not available yet: run 20261030000022_shared_wine_profiles.sql.
              </p>
            )}
          </Section>
          <Section title="By task">
            <SplitTable rows={range.by_task} />
          </Section>
          <Section
            title="By model"
            note="The model that answered (a dated snapshot when the provider said so)."
          >
            <SplitTable rows={range.by_model} />
          </Section>
          <Section
            title="Platform budget"
            note="As the budget guard counts it: recorded usage (its cost, or its hold when unknown) plus holds of calls still in flight or never recorded. A hold is removed once its usage is recorded, so nothing is counted twice. This is an application guard, not a provider spending cap: set a hard limit in the OpenAI dashboard as well."
          >
            {budget ? (
              <Kpis>
                <BudgetKpi label="Today" use={budget.day} />
                <BudgetKpi label="This month" use={budget.month} />
                <Kpi label="Outstanding holds" value={num(budget.openHolds)} hint="This month" />
              </Kpis>
            ) : (
              <Notice>{unavailable(data.budget)}</Notice>
            )}
          </Section>
        </>
      )}
    </>
  );
}

const compact = (n: number) =>
  n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

function unknownHint(s: { unknownCostCalls: number } | null) {
  return s && s.unknownCostCalls > 0
    ? `+ ${num(s.unknownCostCalls)} calls with unknown cost`
    : "Estimate";
}

function BudgetKpi({
  label,
  use,
}: {
  label: string;
  use: {
    recorded: number;
    held: number;
    total: number;
    limit: number | null;
    share: number | null;
  };
}) {
  return (
    <Kpi
      label={`${label}: ${use.limit === null ? "no limit set" : `limit ${usd(use.limit)}`}`}
      value={usd(use.total)}
      hint={`${usd(use.recorded)} recorded + ${usd(use.held)} held${use.share === null ? "" : ` · ${pct(use.share)} of limit`}`}
    />
  );
}

function SplitTable({
  rows,
}: {
  rows: ReadonlyArray<{
    key: string;
    calls: number;
    ok: number;
    known_cost: number;
    unknown_calls: number;
    web_searches: number;
    tokens_in: number;
    tokens_out: number;
  }>;
}) {
  return (
    <Table
      head={[
        { label: "Name" },
        { label: "Calls", numeric: true },
        { label: "Succeeded", numeric: true },
        { label: "Estimated cost", numeric: true },
        { label: "Unknown cost", numeric: true },
        { label: "Searches", numeric: true },
        { label: "Tokens in / out", numeric: true },
      ]}
      rows={rows.map((r) => ({
        key: r.key,
        cells: [
          r.key,
          num(r.calls),
          num(r.ok),
          usd(r.known_cost),
          num(r.unknown_calls),
          num(r.web_searches),
          `${compact(r.tokens_in)} / ${compact(r.tokens_out)}`,
        ],
      }))}
    />
  );
}
