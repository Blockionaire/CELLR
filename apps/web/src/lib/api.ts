import type { ErrorCode } from "@cellr/domain";
import { knownMessage, type KnownKey } from "./known-messages";

/** The error keys a screen's translator must know: one per code, plus the known server sentences. */
export type ErrorKey = `errors.${ErrorCode | "network"}` | `errors.known.${KnownKey}`;

/** A failed API call, with a code the UI can translate. `NETWORK` means we never reached the server. */
export class ApiError extends Error {
  readonly code: ErrorCode | "NETWORK";
  readonly retryable: boolean;
  /** True when the server sent its own wording (custom text beyond the code's default). */
  readonly serverMessage: string | null;

  constructor(code: ErrorCode | "NETWORK", message: string, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = retryable;
    this.serverMessage = message || null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const init: RequestInit = { method, credentials: "same-origin" };
    if (body instanceof FormData) {
      init.body = body; // the browser adds the multipart boundary itself
    } else if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    response = await fetch(`/api/v1${path}`, init);
  } catch {
    throw new ApiError("NETWORK", "", true);
  }

  if (response.status === 204) return undefined as T;
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (
      json as { error?: { code?: ErrorCode; message?: string; retryable?: boolean } } | null
    )?.error;
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? "",
      error?.retryable ?? response.status >= 500,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  /** Sends files (a photo); everything else goes as JSON. */
  upload: <T>(path: string, form: FormData, method: "POST" | "PUT" = "POST") =>
    request<T>(method, path, form),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};

/**
 * Picks the wording for an error. Server text that is just the code's stock sentence is replaced by
 * the translated one, and so is a custom sentence we know (e.g. "You're the last owner…"); any other custom
 * server text is kept as it is.
 */
export function errorMessage(
  error: unknown,
  t: (key: ErrorKey) => string,
  stock: Record<ErrorCode, string>,
): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK") return t("errors.network");
    const known = knownMessage(error.serverMessage);
    if (known) return t(`errors.known.${known}`);
    if (error.serverMessage && error.serverMessage !== stock[error.code])
      return error.serverMessage;
    return t(`errors.${error.code}`);
  }
  return t("errors.INTERNAL");
}

/**
 * The wording for a form check that failed on this side (a zod issue): the translated sentence when we know it,
 * else the general "something doesn't look right", never a library's English.
 */
export function checkMessage(
  issues: ReadonlyArray<{ message: string }>,
  t: (key: ErrorKey) => string,
): string {
  const known = knownMessage(issues[0]?.message);
  return known ? t(`errors.known.${known}`) : t("errors.VALIDATION");
}
