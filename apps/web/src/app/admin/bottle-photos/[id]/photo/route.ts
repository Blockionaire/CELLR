import { z } from "zod";
import { BOTTLE_PHOTO_MAX } from "@cellr/domain";
import { bottleLibrary, getAdminSession } from "@/server/admin/service";
import { imageResponse } from "@/server/http";

/**
 * GET ?n=1..3 → one photo of a contribution someone sent, for the admin only (never stored by the browser). Anyone
 * else: not found.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const id = z.uuid().safeParse((await params).id);
  if (!session || !id.success) return new Response(null, { status: 404 });
  const n = z.coerce
    .number()
    .int()
    .min(1)
    .max(BOTTLE_PHOTO_MAX)
    .catch(1)
    .parse(new URL(request.url).searchParams.get("n") ?? 1);
  const bytes = await bottleLibrary.photoFile(session, id.data, n);
  if (!bytes) return new Response(null, { status: 404 });
  return imageResponse(bytes, { noStore: true });
}
