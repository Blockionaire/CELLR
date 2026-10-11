import "server-only";
import { getPublicEnv, isDevelopment, type PublicEnv } from "@/lib/public-env";

/** Server-side view of the environment. Validated lazily, so `next build` works without secrets. */
export type ServerEnv = PublicEnv;

export function getServerEnv(): ServerEnv {
  return getPublicEnv();
}

/** The /design gallery is for development and for Vercel *preview* deployments (set DESIGN_GALLERY=1 there). */
export function isDesignGalleryEnabled(): boolean {
  return isDevelopment() || process.env.DESIGN_GALLERY === "1";
}
