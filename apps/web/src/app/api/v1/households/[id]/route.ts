import { z } from "zod";
import { DomainError, UpdateHouseholdSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

const idOf = (params: Params): string => {
  const parsed = z.uuid().safeParse(params.id);
  if (!parsed.success) throw new DomainError("NOT_FOUND");
  return parsed.data;
};

export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).households.getHousehold(idOf(params)),
);

export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const patch = await readJson(request, UpdateHouseholdSchema);
  return servicesFor(ctx).households.updateHousehold(idOf(params), patch);
});

/** DELETE → deletes the household and everything in it. Owner only. */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  await servicesFor(ctx).households.deleteHousehold(idOf(params));
});
