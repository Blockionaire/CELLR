import { z } from "zod";
import { getAdminSession, wineMaster } from "@/server/admin/service";
import { imageResponse } from "@/server/http";

/** GET → a curated label of this wine (a draft too), for the admin's preview. Anyone else: not found. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; labelId: string }> },
) {
  const session = await getAdminSession();
  const p = await params;
  const ids = z.object({ id: z.uuid(), labelId: z.uuid() }).safeParse(p);
  if (!session || !ids.success) return new Response(null, { status: 404 });
  const file = await wineMaster.labelFile(session, ids.data.id, ids.data.labelId);
  if (!file) return new Response(null, { status: 404 });
  return imageResponse(file.bytes, {
    noStore: true,
    type: file.type === "image/png" ? "image/png" : "image/jpeg",
  });
}
