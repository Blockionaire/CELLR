// Every failure the tool can meet has its own class, so the caller decides by type, never by message text.

/** Exit codes. Anything that is not 0 means "do not trust this run". */
export const EXIT = {
  ok: 0,
  failed: 1, // incomplete, inconsistent or unverified backup / verify / restore
  usage: 2, // wrong arguments or configuration
  auth: 3, // the key was refused (expired, revoked, wrong project)
  refused: 4, // a safety rule refused the request (production target, unsafe folder, existing directory, ...)
} as const;

export class UsageError extends Error {
  override name = "UsageError";
}

/** A safety rule refused the operation before anything was sent or written. */
export class SafetyError extends Error {
  override name = "SafetyError";
}

/** The HTTP layer refused to send a request that is not on the allowlist of the current mode. */
export class GuardError extends SafetyError {
  override name = "GuardError";
}

/** 401/403, or Storage's 400 with statusCode 401/403 in the body. Never retried: it aborts the whole run. */
export class AuthError extends Error {
  override name = "AuthError";
}

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** Storage's "Duplicate" (409): the object already exists at the target. */
export class ConflictError extends Error {
  override name = "ConflictError";
}

/** Worth another attempt: 408/425/429/5xx, connection errors, timeouts, a body that ended early. */
export class RetryableError extends Error {
  override name = "RetryableError";
  constructor(
    message: string,
    readonly retryAfterMs?: number,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Any other HTTP error (400 InvalidKey, 413, ...): not retried. */
export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The local disk failed (full, no permission). Not retried: it aborts the whole run. */
export class LocalIOError extends Error {
  override name = "LocalIOError";
}

/** The bytes received do not match what the server said they would be (size, MD5 ETag). */
export class IntegrityError extends RetryableError {
  override name = "IntegrityError";
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof UsageError) return EXIT.usage;
  if (error instanceof AuthError) return EXIT.auth;
  if (error instanceof SafetyError) return EXIT.refused;
  return EXIT.failed;
}
