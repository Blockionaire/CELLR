import { notFound } from "next/navigation";
import { parseAdminPage } from "@cellr/domain";
import { adminUsers, getAdminSession } from "@/server/admin/service";
import { Notice, PageTitle, Pager, Table, date, num, unavailable } from "../_ui";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const page = parseAdminPage((await searchParams).page);
  const result = await adminUsers(session, page);
  const blocked = unavailable(result);
  if (blocked || typeof result !== "object" || !result)
    return (
      <>
        <PageTitle title="Users" />
        <Notice>{blocked}</Notice>
      </>
    );
  const status = (onboarded: boolean, activated: boolean) =>
    activated ? "Activated" : onboarded ? "Onboarded" : "Signed up";
  return (
    <>
      <PageTitle
        title="Users"
        crumbs={[{ label: "Users" }]}
        note={`${num(result.total)} accounts, newest first. Last activity is the latest known action (database or first-party event).`}
      />
      <Table
        head={[
          { label: "User" },
          { label: "Signed up" },
          { label: "Last activity" },
          { label: "Status" },
          { label: "Households", numeric: true },
          { label: "Bottles added", numeric: true },
        ]}
        rows={result.rows.map((r) => ({
          key: r.user_id,
          href: `/admin/users/${r.user_id}`,
          cells: [
            <>
              <span className="block text-ink">{r.display_name ?? "—"}</span>
              <span className="block font-mono text-caption font-normal text-ink-3">
                {r.user_id}
              </span>
            </>,
            date(r.created_at),
            date(r.last_active_at),
            status(r.onboarded, r.activated),
            num(r.households),
            num(r.bottles_added),
          ],
        }))}
        empty="No accounts on this page."
      />
      <Pager page={page} pages={result.pages} href={(p) => `/admin/users?page=${p}`} />
    </>
  );
}
