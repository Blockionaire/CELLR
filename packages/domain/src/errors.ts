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
  "OTP_INVALID",
  "PIN_INVALID",
  "SIGNUP_CLOSED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status for each code (used by /api/v1; native clients get the same contract). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  UPLOAD_REJECTED: 422,
  INVITE_INVALID: 422,
  OTP_INVALID: 422,
  PIN_INVALID: 422,
  SIGNUP_CLOSED: 403,
  INTERNAL: 500,
};

/**
 * Default copy for every code — human, calm, always pointing at a next step. Never HTTP jargon.
 * (The UI will key translations off `code`; these are the English source strings.)
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You don't have access to that.",
  NOT_FOUND: "We couldn't find that.",
  VALIDATION: "Something in that doesn't look right. Please check it and try again.",
  CONFLICT: "That can't be done right now.",
  RATE_LIMITED: "That's a lot of tries in a short time. Give it a minute and try again.",
  AI_UNAVAILABLE: "Our sommelier is taking a break. Please try again in a moment.",
  UPLOAD_REJECTED: "We couldn't use that photo. Try another one.",
  INVITE_INVALID: "That invite code didn't work. Check it, or ask for a new one.",
  OTP_INVALID: "That code didn't work. Check it, or ask for a new one.",
  PIN_INVALID:
    "That PIN didn't work. After five wrong tries the PIN switches off and you sign in with an email code.",
  SIGNUP_CLOSED: "CELLR is invite-only for now, and this email isn't on the list yet.",
  INTERNAL: "Something went wrong on our side. Please try again.",
};

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(
      message ?? ERROR_MESSAGES[code],
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "DomainError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export const isDomainError = (e: unknown): e is DomainError => e instanceof DomainError;

/** Wire format of every failed /api/v1 response. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean };
}
