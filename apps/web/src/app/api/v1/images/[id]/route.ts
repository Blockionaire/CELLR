import { DomainError } from "@cellr/domain";
import { authed, imageResponse, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET ?size=thumb|photo|texture → the picture itself, for the household's own screens. Anyone else gets "not found". */
export const GET = authed<Params>(async ({ request, ctx, params }) => {
  const size = new URL(request.url).searchParams.get("size") ?? "photo";
  if (size !== "thumb" && size !== "photo" && size !== "texture")
    throw new DomainError("VALIDATION");
  return imageResponse(await servicesFor(ctx).images.file(uuidParam(params.id), size), {
    changes: size === "texture",
  });
});
