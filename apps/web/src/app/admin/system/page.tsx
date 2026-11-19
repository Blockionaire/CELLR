import { notFound } from "next/navigation";
import { ArchitectureControlCenter } from "@/features/admin/system/control-center";
import { adminArchitecture, getAdminSession } from "@/server/admin/service";
import { PageTitle } from "../_ui";

export const dynamic = "force-dynamic";

/**
 * System › Architecture (System Intelligence sprint 1): the evidence-checked map of how CELLR is built. The register
 * reaches the browser only here, after the admin check, as props of the client component.
 */
export default async function AdminSystemPage() {
  const session = await getAdminSession();
  if (!session) notFound();
  const view = adminArchitecture(session);
  return (
    <>
      <PageTitle
        title="Architecture"
        crumbs={[{ label: "System" }, { label: "Architecture" }]}
        note="How CELLR is built: every component, and every line between them proven by a file in the repository (checked in CI). Structure only — no live data, so it works when anything else is down. Health and incidents follow in their own overlay."
      />
      <ArchitectureControlCenter view={view} />
    </>
  );
}
