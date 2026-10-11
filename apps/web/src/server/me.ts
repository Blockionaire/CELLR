import "server-only";
import { cache } from "react";
import { getPageContext } from "./context";
import { servicesFor } from "./services";

/** Who is signed in, with households — one lookup per render, shared by layout and page. */
export const getPageMe = cache(async () => {
  const ctx = await getPageContext();
  return ctx ? servicesFor(ctx).households.me() : null;
});
