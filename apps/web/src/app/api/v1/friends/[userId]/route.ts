import { z } from "zod";
import { DomainError } from "@cellr/domain";
import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { userId: string };

const idOf = (params: Params): string => {
  const parsed = z.uuid().safeParse(params.userId);
  if (!parsed.success) throw new DomainError("NOT_FOUND");
  return parsed.data;
};

/** GET → a friend, and what they let me see: ratings, taste profile, cellar and racks. */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).friends.friend(idOf(params)),
);

/** DELETE → no longer friends (or withdraw my request). */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).friends.remove(idOf(params)),
);
