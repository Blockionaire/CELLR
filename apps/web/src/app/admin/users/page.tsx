import Link from "next/link";
import { notFound } from "next/navigation";
import { parseAdminPage } from "@cellr/domain";
import { adminUsers, getAdminSession } from "@/server/admin/service";
import { Notice, PageTitle, Table, date, num, unavailable } from "../_ui";

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
          cells: [
            <Link
              key="u"
              href={`/admin/users/${r.user_id}`}
              prefetch={false}
              className="hover:underline"
            >
              <span className="block text-ink">{r.display_name ?? "—"}</span>
              <span className="block font-mono text-caption text-ink-3">{r.user_id}</span>
            </Link>,
            date(r.created_at),
            date(r.last_active_at),
            status(r.onboarded, r.activated),
            num(r.households),
            num(r.bottles_added),
          ],
        }))}
        empty="No accounts on this page."
      />
      <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-small">
        {page > 1 ? (
          <Link href={`/admin/users?page=${page - 1}`} prefetch={false} className="text-accent-ink">
            ← Newer
          </Link>
        ) : (
          <span />
        )}
        <span className="text-ink-2">
          Page {num(page)} of {num(result.pages)}
        </span>
        {page < result.pages ? (
          <Link href={`/admin/users?page=${page + 1}`} prefetch={false} className="text-accent-ink">
            Older →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}
