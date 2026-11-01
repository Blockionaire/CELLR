import { z } from "zod";
import { getAdminSession, wineMaster } from "@/server/admin/service";
import { imageResponse } from "@/server/http";

/**
 * GET → a household's own label photo of a bottle of this wine, for the admin's eyes only (never stored by the
 * browser, never shared by this). Anyone else, or a photo of another wine: not found.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const session = await getAdminSession();
  const p = await params;
  const ids = z.object({ id: z.uuid(), imageId: z.uuid() }).safeParse(p);
  if (!session || !ids.success) return new Response(null, { status: 404 });
  const bytes = await wineMaster.householdLabelFile(session, ids.data.id, ids.data.imageId);
  if (!bytes) return new Response(null, { status: 404 });
  return imageResponse(bytes, { noStore: true });
}
