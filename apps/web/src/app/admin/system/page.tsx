import { notFound } from "next/navigation";
import { ArchitectureControlCenter } from "@/features/admin/system/control-center";
import { adminArchitecture, adminHealthOverlay, getAdminSession } from "@/server/admin/service";
import { PageTitle } from "../_ui";

export const dynamic = "force-dynamic";

/**
 * System › Architecture (System Intelligence sprint 1): the evidence-checked map of how CELLR is built. The register
 * reaches the browser only here, after the admin check, as props of the client component. The health overlay
 * (sprint 2) is read with a short limit and never throws: when monitoring is slow or down the map renders all the same.
 */
export default async function AdminSystemPage() {
  const session = await getAdminSession();
  if (!session) notFound();
  const view = adminArchitecture(session);
  const health = await adminHealthOverlay(session);
  return (
    <>
      <PageTitle
        title="Architecture"
        crumbs={[{ label: "System" }, { label: "Architecture" }]}
        note="How CELLR is built: every component, and every line between them proven by a file in the repository (checked in CI). The structure needs no live data, so it works when anything else is down; measured health is an overlay on top."
      />
      <ArchitectureControlCenter view={view} health={health} />
    </>
  );
}
