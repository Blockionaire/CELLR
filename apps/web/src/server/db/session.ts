import "server-only";
import { DomainError, isDomainError } from "@cellr/domain";
import { createBearerClient, createCookieClient, type Db } from "./clients";

export interface SessionInfo {
  userId: string;
  email: string | null;
  db: Db;
  via: "cookie" | "bearer";
}

export function parseBearer(header: string | null | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header?.trim() ?? "");
  return match?.[1] ?? null;
}

type Claims = { sub?: string; email?: string; role?: string } | null | undefined;

/** Only a signed JWT for a real, signed-in user counts — not the publishable key, not an anon token. */
export function userIdFromClaims(claims: Claims): string | null {
  if (!claims?.sub || claims.role !== "authenticated") return null;
  return claims.sub;
}

/** An auth server that did not answer (network, 5xx) — as opposed to one that said "this token is bad". */
export function isTransientAuthError(error: {
  name?: string;
  status?: number | undefined;
}): boolean {
  return (
    error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status ?? 0) >= 500
  );
}

type ClaimsResult = {
  data: { claims: Claims & { email?: string } } | null;
  error: { name?: string; status?: number | undefined } | null;
};

/**
 * Reads the verified identity from a token. Never throws for a bad token:
 *  - getClaims() RETURNS an error for most malformed tokens but THROWS for some (e.g. undecodable
 *    base64) — both mean "not signed in", never a 500;
 *  - an auth server that cannot be reached is a retryable INTERNAL error, not a false "signed out".
 */
export async function identify(
  getClaims: () => Promise<ClaimsResult>,
): Promise<{ userId: string; email: string | null } | null> {
  let result: ClaimsResult;
  try {
    result = await getClaims();
  } catch {
    return null;
  }
  if (result.error) {
    if (isTransientAuthError(result.error))
      throw new DomainError("INTERNAL", undefined, { retryable: true, cause: result.error });
    return null;
  }
  const claims = result.data?.claims;
  const userId = userIdFromClaims(claims);
  return userId ? { userId, email: claims?.email ?? null } : null;
}

/**
 * Resolves who is calling. `getClaims()` verifies the token's signature (locally for asymmetric
 * keys), refreshing an expired cookie session first. Returns null when nobody is signed in.
 */
export async function resolveSession(request?: Request): Promise<SessionInfo | null> {
  try {
    const bearer = parseBearer(request?.headers.get("authorization"));
    if (bearer) {
      const db = createBearerClient(bearer);
      const who = await identify(() => db.auth.getClaims(bearer));
      return who ? { ...who, db, via: "bearer" } : null;
    }
    const db = await createCookieClient();
    const who = await identify(() => db.auth.getClaims());
    return who ? { ...who, db, via: "cookie" } : null;
  } catch (error) {
    if (isDomainError(error)) throw error;
    throw new DomainError("INTERNAL", undefined, { retryable: true, cause: error });
  }
}
