import { z } from "zod";
import { BOTTLE_ART_LIMITS, CATALOG_LABEL_SOURCE_MAX, DomainError } from "@cellr/domain";
import { adminUploadCatalogLabel, getAdminSession } from "@/server/admin/service";
import { checkOrigin, readForm } from "@/server/http";

/**
 * POST multipart { label, side, vintage, source } → a curated front or back label for this catalogue wine, kept as
 * a draft until it is published. A plain form post from the wine's admin page, which it returns to with a message.
 * Same-origin only; the admin check runs here again. Household label photos are never copied here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  const wine = z.uuid().safeParse((await params).id);
  if (!session || !wine.success) return new Response(null, { status: 404 });
  const back = (message: string) =>
    new Response(null, {
      status: 303,
      headers: {
        location: `/admin/wines/${wine.data}?msg=${encodeURIComponent(message)}#labels`,
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
  const file = form.get("label");
  if (!(file instanceof File) || file.size === 0) return back("Choose a label image first.");
  const side = z.enum(["front", "back"]).safeParse(form.get("side"));
  const vintage = z.union([z.uuid(), z.literal("")]).safeParse(form.get("vintage") ?? "");
  const source = String(form.get("source") ?? "")
    .trim()
    .slice(0, CATALOG_LABEL_SOURCE_MAX);
  if (!side.success || !vintage.success || !source)
    return back("Not uploaded: choose the side and say where the image comes from.");
  const result = await adminUploadCatalogLabel(
    session,
    wine.data,
    new Uint8Array(await file.arrayBuffer()),
    { side: side.data, vintageId: vintage.data || null, source },
  );
  return back(result.ok ? "Label uploaded as a draft. Publish it to share it." : result.message);
}
