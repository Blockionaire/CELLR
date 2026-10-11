import type { ErrorCode } from "@cellr/domain";

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
    if (body !== undefined) {
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
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
};

/**
 * Picks the wording for an error. Server text that is just the code's stock sentence is replaced by
 * the translated one; custom server text (e.g. "You're the last owner…") is kept.
 */
export function errorMessage(
  error: unknown,
  t: (key: `errors.${ErrorCode | "network"}`) => string,
  stock: Record<ErrorCode, string>,
): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK") return t("errors.network");
    if (error.serverMessage && error.serverMessage !== stock[error.code])
      return error.serverMessage;
    return t(`errors.${error.code}`);
  }
  return t("errors.INTERNAL");
}
