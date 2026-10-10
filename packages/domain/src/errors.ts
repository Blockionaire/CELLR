/**
 * Typed, human-facing errors. Services throw DomainError; the API layer maps `code` to an HTTP
 * status and the UI maps `code` to copy. Nothing above the service layer sees a raw database error.
 */
export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "AI_UNAVAILABLE",
  "UPLOAD_REJECTED",
  "INVITE_INVALID",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;
