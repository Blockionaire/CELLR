import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AUTO_PUBLISH_ENABLED, WINE_TYPES } from "@cellr/domain";
import { adminCandidate, getAdminSession } from "@/server/admin/service";
import { Kpi, Kpis, Notice, PageTitle, Section, Table, date, num } from "../../_ui";
import { approveAction, editAction, mergeAction, sourceAction, statusAction } from "../actions";
import { STATE_LABEL } from "../labels";

export const dynamic = "force-dynamic";

const input = "rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline";
const button = "rounded-full bg-ink px-4 py-2 text-small text-canvas";
const quiet = "rounded-full px-4 py-2 text-small text-ink ring-1 ring-hairline";

/**
 * One candidate: what households confirmed (counts and variations, never who), how it compares with the catalogue,
 * and the review actions. Approving publishes through the catalogue import: a verified public source is required.
 */
export default async function AdminCandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const msg = (await searchParams).msg;
  const message = typeof msg === "string" ? msg.slice(0, 300) : null;
  const data = await adminCandidate(session, id.data);
  if (data === "missing" || data === null)
    return (
      <>
        <PageTitle title="Candidate" />
        <Notice>
          Not available: run 20261101000024_catalog_learning.sql (and set the service role).
        </Notice>
      </>
    );
  if (data === "none") notFound();
  const { detail: c, row, state, verdict } = data;
  const open = c.status === "open";
  const vintageLabel = (y: number | null) => (y === null ? "Non-vintage" : String(y));

  return (
    <>
      <PageTitle
        title={`${c.producer} — ${c.name}`}
        note={`Candidate · ${STATE_LABEL[state]} · grouping key ${c.identityKey}`}
      >
        <Link href="/admin/catalog" prefetch={false} className="text-small text-accent-ink">
          ← All candidates
        </Link>
      </PageTitle>
      {message && <Notice>{message}</Notice>}

      <Section
        title="Evidence"
        note="Independent households, never which ones. Typed wines are weaker and never count towards review."
      >
        <Kpis>
          <Kpi label="Households (from a label)" value={num(c.scanHouseholds)} />
          <Kpi label="Households (typed only)" value={num(c.manualHouseholds)} />
          <Kpi label="Rival colours/countries" value={num(row.rivals)} />
          <Kpi label="Appellations given" value={num(row.appellationVariants)} />
        </Kpis>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Table
            head={[
              { label: "Vintage" },
              { label: "Label", numeric: true },
              { label: "Typed", numeric: true },
            ]}
            rows={c.vintages.map((v) => ({
              key: String(v.year),
              cells: [vintageLabel(v.year), num(v.scanHouseholds), num(v.manualHouseholds)],
            }))}
            empty="No active evidence."
          />
          <Table
            head={[
              { label: "As households wrote it" },
              { label: "Origin" },
              { label: "Households", numeric: true },
            ]}
            rows={c.variations.map((v, i) => ({
              key: String(i),
              cells: [
                `${v.producer} — ${v.name}`,
                [v.region, v.appellation].filter(Boolean).join(" · ") || "—",
                num(v.households),
              ],
            }))}
            empty="No variations."
          />
        </div>
      </Section>

      <Section
        title="Automation (advice only)"
        note={`Automatic publication is ${AUTO_PUBLISH_ENABLED ? "ON" : "OFF"}: approval is always your decision. This shows whether it would qualify.`}
      >
        <p className="text-small">{verdict.eligible ? "Would qualify." : "Would not qualify:"}</p>
        {!verdict.eligible && (
          <ul className="mt-1 list-disc pl-5 text-small text-ink-2">
            {verdict.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="The catalogue and similar candidates">
        <div className="grid gap-4 md:grid-cols-2">
          <Table
            head={[{ label: "Catalogue wines of this producer" }, { label: "Type · country" }]}
            rows={c.catalogWines.map((w) => ({
              key: w.id,
              cells: [w.name, [w.type, w.country].filter(Boolean).join(" · ")],
            }))}
            empty="None yet."
          />
          <Table
            head={[
              { label: "Other candidates of this producer" },
              { label: "Type · country · status" },
            ]}
            rows={c.siblings.map((s) => ({
              key: s.id,
              cells: [
                <Link
                  key="s"
                  href={`/admin/catalog/${s.id}`}
                  prefetch={false}
                  className="text-accent-ink"
                >
                  {s.name}
                </Link>,
                [s.type, s.country, s.status].filter(Boolean).join(" · "),
              ],
            }))}
            empty="None."
          />
        </div>
      </Section>

      <Section
        title="Proposed identity"
        note={
          open
            ? "Correct it before approving. Aliases: one per line, only names of this exact wine."
            : `This candidate is ${c.status}.`
        }
      >
        <form action={editAction.bind(null, c.id)} className="grid gap-3 text-small md:grid-cols-2">
          <label className="flex flex-col gap-1">
            Producer
            <input
              name="producer"
              defaultValue={c.producer}
              className={input}
              disabled={!open}
              required
              maxLength={120}
            />
          </label>
          <label className="flex flex-col gap-1">
            Wine / cuvée
            <input
              name="name"
              defaultValue={c.name}
              className={input}
              disabled={!open}
              required
              maxLength={160}
            />
          </label>
          <label className="flex flex-col gap-1">
            Type
            <select name="type" defaultValue={c.type} className={input} disabled={!open}>
              {WINE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Country (2 letters)
            <input
              name="country"
              defaultValue={c.country ?? ""}
              className={input}
              disabled={!open}
              maxLength={2}
            />
          </label>
          <label className="flex flex-col gap-1">
            Region
            <input
              name="region"
              defaultValue={c.region ?? ""}
              className={input}
              disabled={!open}
              maxLength={120}
            />
          </label>
          <label className="flex flex-col gap-1">
            Appellation
            <input
              name="appellation"
              defaultValue={c.appellation ?? ""}
              className={input}
              disabled={!open}
              maxLength={160}
            />
          </label>
          <label className="flex flex-col gap-1">
            Classification
            <input
              name="classification"
              defaultValue={c.classification ?? ""}
              className={input}
              disabled={!open}
              maxLength={120}
            />
          </label>
          <label className="flex flex-col gap-1">
            Aliases
            <textarea
              name="aliases"
              defaultValue={c.aliases.join("\n")}
              rows={3}
              className={input}
              disabled={!open}
            />
          </label>
          {open && (
            <div>
              <button type="submit" className={button}>
                Save identity
              </button>
            </div>
          )}
        </form>
      </Section>

      <Section
        title="Public sources"
        note="An https page that names this exact wine (best: the producer's own site). Approval needs at least one you verified."
      >
        <Table
          head={[{ label: "Source" }, { label: "Verified" }]}
          rows={c.sources.map((s) => ({
            key: s.id,
            cells: [
              <a
                key="u"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-accent-ink"
              >
                {s.name}
              </a>,
              s.verified ? "Yes" : "No",
            ],
          }))}
          empty="No sources yet."
        />
        {open && (
          <form
            action={sourceAction.bind(null, c.id)}
            className="mt-3 flex flex-wrap items-end gap-3 text-small"
          >
            <label className="flex flex-col gap-1">
              Name
              <input name="name" className={input} required maxLength={120} />
            </label>
            <label className="flex flex-col gap-1">
              https link
              <input
                name="url"
                type="url"
                className={input}
                required
                maxLength={500}
                pattern="https://.*"
              />
            </label>
            <label className="flex flex-col gap-1">
              License
              <input name="license" defaultValue="facts" className={input} maxLength={80} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="verified" /> I checked it names this exact wine
            </label>
            <button type="submit" className={button}>
              Save source
            </button>
          </form>
        )}
      </Section>

      {open && (
        <Section
          title="Decide"
          note="Approving publishes the identity above into the canonical catalogue (through catalog_import: idempotent, nothing overwritten). Household wines and bottles are not changed."
        >
          <form
            action={approveAction.bind(null, c.id)}
            className="flex flex-wrap items-end gap-3 text-small"
          >
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-ink-2">Vintages to publish (only confirmed ones)</legend>
              {c.vintages.map((v) => (
                <label key={String(v.year)} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="vintage"
                    value={v.year === null ? "nv" : String(v.year)}
                    defaultChecked
                  />
                  {vintageLabel(v.year)}
                </label>
              ))}
            </fieldset>
            <button type="submit" className={button}>
              Approve and publish
            </button>
          </form>
          <form
            action={statusAction.bind(null, c.id, "rejected")}
            className="mt-4 flex flex-wrap items-end gap-3 text-small"
          >
            <label className="flex flex-col gap-1">
              Why (optional)
              <input name="note" className={input} maxLength={500} />
            </label>
            <button type="submit" className={quiet}>
              Reject
            </button>
          </form>
          {c.siblings.some((s) => s.status === "open") && (
            <form
              action={mergeAction.bind(null, c.id)}
              className="mt-4 flex flex-wrap items-end gap-3 text-small"
            >
              <label className="flex flex-col gap-1">
                Same wine as
                <select name="into" className={input}>
                  {c.siblings
                    .filter((s) => s.status === "open")
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({[s.type, s.country].filter(Boolean).join(", ")})
                      </option>
                    ))}
                </select>
              </label>
              <button type="submit" className={quiet}>
                Merge into it
              </button>
            </form>
          )}
        </Section>
      )}
      {c.status === "rejected" && (
        <Section title="Rejected" {...(c.reviewNote ? { note: c.reviewNote } : {})}>
          <form action={statusAction.bind(null, c.id, "open")}>
            <button type="submit" className={quiet}>
              Reopen for review
            </button>
          </form>
        </Section>
      )}

      <Section title="History">
        <Table
          head={[{ label: "When" }, { label: "Action" }]}
          rows={c.audit.map((a, i) => ({ key: String(i), cells: [date(a.at), a.action] }))}
          empty="Nothing yet."
        />
      </Section>
    </>
  );
}
