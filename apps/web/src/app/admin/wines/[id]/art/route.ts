import { z } from "zod";
import { BOTTLE_ART_LIMITS, DomainError } from "@cellr/domain";
import { adminUploadBottleArt, getAdminSession } from "@/server/admin/service";
import { checkOrigin, readForm } from "@/server/http";

/**
 * POST multipart { picture, note } → a finished 2D bottle picture for this canonical wine, kept as a draft until
 * it is published. A plain form post from the wine's admin page, which it returns to with a message. Same-origin
 * only, and the admin check runs here again (a route is not covered by the admin layout).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const wine = z.uuid().safeParse((await params).id);
  if (!session || !wine.success) return new Response(null, { status: 404 });
  const back = (message: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `/admin/wines/${wine.data}?msg=${encodeURIComponent(message)}`,
        "cache-control": "no-store",
      },
    });
  try {
    checkOrigin(request);
  } catch {
    return new Response(null, { status: 403 });
  }
  let form: FormData;
  try {
    form = await readForm(request, BOTTLE_ART_LIMITS.bytes + 64 * 1024);
  } catch (e) {
    return back(
      e instanceof DomainError ? "Not uploaded: the file is too large." : "Not uploaded.",
    );
  }
  const picture = form.get("picture");
  if (!(picture instanceof File) || picture.size === 0) return back("Choose a picture first.");
  const result = await adminUploadBottleArt(
    session,
    wine.data,
    new Uint8Array(await picture.arrayBuffer()),
    String(form.get("note") ?? ""),
  );
  return back(
    result.ok ? "Uploaded as a draft. Publish it to show it in the app." : result.message,
  );
}
