import "server-only";
import { cache } from "react";
import { DomainError } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { resolveSession } from "@/server/db/session";

export interface RequestContext {
  userId: string;
  email: string | null;
  /** Supabase client acting AS the caller: row-level security applies. */
  db: Db;
  via: "cookie" | "bearer";
}

/** For API routes: pass the request so `Authorization: Bearer` (native clients) is honoured. */
export async function getOptionalContext(request?: Request): Promise<RequestContext | null> {
  return resolveSession(request);
}

export async function requireContext(request?: Request): Promise<RequestContext> {
  const ctx = await resolveSession(request);
  if (!ctx) throw new DomainError("UNAUTHENTICATED");
  return ctx;
}

/** For Server Components: one session lookup per render, shared by every component that asks. */
export const getPageContext = cache(async (): Promise<RequestContext | null> => resolveSession());
