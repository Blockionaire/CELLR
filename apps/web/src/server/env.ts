import "server-only";
import { getPublicEnv, type PublicEnv } from "@/lib/public-env";

/** Server-side view of the environment. Validated lazily, so `next build` works without secrets. */
export type ServerEnv = PublicEnv;

export function getServerEnv(): ServerEnv {
  return getPublicEnv();
}
