import Link from "next/link";
import { notFound } from "next/navigation";
import { adminUser, getAdminSession } from "@/server/admin/service";
import {
  Kpi,
  Kpis,
  Notice,
  PageTitle,
  Section,
  Table,
  date,
  num,
  unavailable,
  usd,
} from "../../_ui";

export const dynamic = "force-dynamic";

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) notFound();
  const summary = await adminUser(session, (await params).id);
  if (summary === "none") notFound();
  const blocked = unavailable(summary);
  if (blocked || typeof summary !== "object" || !summary)
    return (
      <>
        <PageTitle title="User" />
        <Notice>{blocked}</Notice>
      </>
    );
  const events = Object.entries(summary.events_30d).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <Link href="/admin/users" prefetch={false} className="text-small text-ink-2 hover:underline">
        ← Users
      </Link>
      <PageTitle
        title={summary.display_name ?? "Unnamed user"}
        note={`${summary.user_id} · signed up ${date(summary.created_at)} · last sign-in ${date(summary.last_sign_in_at)}. Counts only: no notes, messages or AI conversations are shown.`}
      />
      <Section title="In the cellar">
        <Kpis>
          <Kpi label="Households" value={num(summary.households)} />
          <Kpi label="Bottles added" value={num(summary.bottles_added)} />
          <Kpi label="Bottles opened" value={num(summary.bottles_opened)} />
          <Kpi label="Ratings" value={num(summary.ratings)} />
        </Kpis>
      </Section>
      <Section
        title="AI use, last 30 days"
        note="Estimated cost from the price list; calls with unknown cost are counted apart."
      >
        <Table
          head={[
            { label: "Task" },
            { label: "Calls", numeric: true },
            { label: "Succeeded", numeric: true },
            { label: "Estimated cost", numeric: true },
            { label: "Unknown cost", numeric: true },
          ]}
          rows={summary.ai_30d.map((a) => ({
            key: a.task,
            cells: [
              a.task,
              num(a.calls),
              num(a.ok),
              usd(a.known_cost_usd_micro),
              num(a.unknown_cost_calls),
            ],
          }))}
          empty="No AI calls in the last 30 days."
        />
      </Section>
      <Section
        title="App events, last 30 days"
        note="First-party events only; missing for people with Do Not Track or GPC."
      >
        <Table
          head={[{ label: "Event" }, { label: "Count", numeric: true }]}
          rows={events.map(([name, n]) => ({ key: name, cells: [name, num(n)] }))}
          empty="No events recorded."
        />
      </Section>
    </>
  );
}
