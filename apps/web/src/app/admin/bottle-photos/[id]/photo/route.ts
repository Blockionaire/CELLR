import { z } from "zod";
import { bottleLibrary, getAdminSession } from "@/server/admin/service";
import { imageResponse } from "@/server/http";

/** GET → a photo someone sent, for the admin only (never stored by the browser). Anyone else: not found. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const id = z.uuid().safeParse((await params).id);
  if (!session || !id.success) return new Response(null, { status: 404 });
  const bytes = await bottleLibrary.photoFile(session, id.data);
  if (!bytes) return new Response(null, { status: 404 });
  return imageResponse(bytes, { noStore: true });
}
