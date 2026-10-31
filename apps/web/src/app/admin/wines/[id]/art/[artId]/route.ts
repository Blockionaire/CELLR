import { z } from "zod";
import { bottleLibrary, getAdminSession } from "@/server/admin/service";
import { imageResponse } from "@/server/http";

/** GET → one of a wine's pictures, a draft too, for the admin's preview only. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artId: string }> },
) {
  const session = await getAdminSession();
  const art = z.uuid().safeParse((await params).artId);
  if (!session || !art.success) return new Response(null, { status: 404 });
  const file = await bottleLibrary.artFile(session, art.data);
  if (!file) return new Response(null, { status: 404 });
  return imageResponse(file.bytes, {
    noStore: true,
    type: file.type === "image/png" ? "image/png" : "image/jpeg",
  });
}
