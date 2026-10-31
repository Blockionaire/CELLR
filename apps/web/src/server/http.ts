import "server-only";
import { z, ZodError, type ZodType } from "zod";
import { DomainError, ERROR_HTTP_STATUS, isDomainError, type ApiErrorBody } from "@cellr/domain";
import { requireContext, type RequestContext } from "./context";
import { logError } from "./log";

export const MAX_BODY_BYTES = 64 * 1024;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Every API response is private and uncacheable. */
function baseHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

export function jsonResponse(body: unknown, status = 200): Response {
  const headers = baseHeaders({ "Content-Type": "application/json; charset=utf-8" });
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: unknown): Response {
  const domainError = isDomainError(error)
    ? error
    : error instanceof ZodError
      ? new DomainError("VALIDATION")
      : new DomainError("INTERNAL", undefined, { cause: error, retryable: true });

  if (domainError.code === "INTERNAL") logError("api_error", domainError.cause ?? domainError);

  const body: ApiErrorBody = {
    error: {
      code: domainError.code,
      message: domainError.message,
      retryable: domainError.retryable,
    },
  };
  return jsonResponse(body, ERROR_HTTP_STATUS[domainError.code]);
}

/**
 * CSRF defence for cookie-authenticated requests: a state-changing request must come from our own
 * origin. Bearer-token callers (native apps) are not cookie-authenticated, so they are exempt.
 */
export function checkOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  if (/^bearer\s/i.test(request.headers.get("authorization") ?? "")) return;

  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new DomainError("FORBIDDEN");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new DomainError("FORBIDDEN");
  }
  if (originHost !== host) throw new DomainError("FORBIDDEN");
}

/**
 * Reads and validates a JSON body. `optional` allows an empty body (the schema then sees `{}` so
 * defaults apply). Oversized or non-JSON bodies are rejected before parsing.
 */
export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
  options: { optional?: boolean; maxBytes?: number } = {},
): Promise<T> {
  const limit = options.maxBytes ?? MAX_BODY_BYTES;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new DomainError("VALIDATION", "That request is too large.");

  const text = await request.text();
  if (text.length > limit) throw new DomainError("VALIDATION", "That request is too large.");

  let raw: unknown = {};
  if (text.trim() !== "") {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      throw new DomainError("VALIDATION");
    }
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DomainError("VALIDATION");
    }
  } else if (!options.optional) {
    throw new DomainError("VALIDATION");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new DomainError("VALIDATION");
  return parsed.data;
}

/** The most one upload may carry: a label photo and its small copy (hosting platforms stop at ~4.5 MB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Reads a multipart form (a photo upload), refusing anything oversized before it is buffered. */
export async function readForm(request: Request, maxBytes = MAX_UPLOAD_BYTES): Promise<FormData> {
  // The size must be declared up front: a body that doesn't say how big it is would be buffered whole first.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared <= 0) throw new DomainError("VALIDATION");
  if (declared > maxBytes)
    throw new DomainError("UPLOAD_REJECTED", "That photo is too large. Try a smaller one.");
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data"))
    throw new DomainError("VALIDATION");
  try {
    return await request.formData();
  } catch {
    throw new DomainError("VALIDATION");
  }
}

/**
 * A photo, for the signed-in person's own screens. The address of a photo never changes what it shows, so
 * the browser may keep it; "private" stops shared caches from ever holding someone's cellar.
 */
export function imageResponse(
  bytes: Uint8Array,
  options: { changes?: boolean; noStore?: boolean } = {},
): Response {
  const headers = new Headers({
    "Content-Type": "image/jpeg",
    // A straightened label can be redone under the same address, so that one is always checked again. A photo whose
    // access can be taken away (a profile photo, once someone leaves the household) is never kept at all: every
    // showing asks the server, so a revoked viewer or the next account on the same browser can't see it from cache.
    "Cache-Control": options.noStore
      ? "no-store"
      : options.changes
        ? "private, no-cache"
        : "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'",
    "Content-Length": String(bytes.byteLength),
  });
  return new Response(new Blob([new Uint8Array(bytes)]), { status: 200, headers });
}

type RouteContext<P> = { params: Promise<P> };

/** Handler results: a Response is passed through, `undefined` becomes 204, anything else is JSON 200. */
function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new Response(null, { status: 204, headers: baseHeaders() });
  return jsonResponse(result);
}

export function created(body: unknown): Response {
  return jsonResponse(body, 201);
}

/** Route that needs no session (sign-in itself). Still origin-checked. */
export function open<P = Record<string, never>>(
  handler: (args: { request: Request; params: P }) => Promise<unknown>,
): (request: Request, context: RouteContext<P>) => Promise<Response> {
  return async (request, context) => {
    try {
      checkOrigin(request);
      return toResponse(await handler({ request, params: await context.params }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** A path id must be a UUID; anything else is simply "not found" (never a validation hint). */
export function uuidParam(value: string): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new DomainError("NOT_FOUND");
  return parsed.data;
}

/** Route that requires a signed-in user (cookie session or bearer token). */
export function authed<P = Record<string, never>>(
  handler: (args: { request: Request; params: P; ctx: RequestContext }) => Promise<unknown>,
): (request: Request, context: RouteContext<P>) => Promise<Response> {
  return async (request, context) => {
    try {
      checkOrigin(request);
      const ctx = await requireContext(request);
      return toResponse(await handler({ request, params: await context.params, ctx }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
