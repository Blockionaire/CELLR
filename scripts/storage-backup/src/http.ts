// The only way the tool talks to Supabase. Every request is checked against the allowlist of the current mode before
// it is sent: in "read" mode (backup, verify, inventory) nothing that can create, change or delete anything can leave
// this file, whatever a bug elsewhere asks for.
import type { Target } from "./config";
import {
  AuthError,
  ConflictError,
  GuardError,
  HttpError,
  LocalIOError,
  NotFoundError,
  RetryableError,
} from "./errors";
import { redact } from "./log";

export type Mode = "read" | "restore";

export interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 5, baseDelayMs: 500, maxDelayMs: 15_000 };

type Method = "GET" | "POST";
type Route = readonly [Method, RegExp];

/** Listing buckets, listing objects (a read-only search) and downloading one object. Nothing else. */
const READ_ROUTES: readonly Route[] = [
  ["GET", /^\/storage\/v1\/bucket$/],
  ["POST", /^\/storage\/v1\/object\/list\/[^/]+$/],
  ["GET", /^\/storage\/v1\/object\/authenticated\/[^/]+\/.+$/],
];

/** Restore, into a target that is not production (checked by the caller and again in restore.ts). */
const RESTORE_ROUTES: readonly Route[] = [
  ...READ_ROUTES,
  ["POST", /^\/storage\/v1\/bucket$/], // create a missing bucket
  // upload one object; never the move/copy/sign/upload-url endpoints
  [
    "POST",
    /^\/storage\/v1\/object\/(?!(list|sign|move|copy|upload|info|authenticated|public|render)\/)[^/]+\/.+$/,
  ],
];

export function assertAllowed(
  mode: Mode,
  method: string,
  pathname: string,
  headers: Record<string, string>,
  allowUpsert: boolean,
): void {
  const routes = mode === "read" ? READ_ROUTES : RESTORE_ROUTES;
  const allowed = routes.some(([m, re]) => m === method && re.test(pathname));
  if (!allowed)
    throw new GuardError(`blocked: ${method} ${pathname} is not allowed in ${mode} mode`);
  const isUpload =
    method === "POST" &&
    /^\/storage\/v1\/object\//.test(pathname) &&
    !/^\/storage\/v1\/object\/list\//.test(pathname);
  if (isUpload) {
    const upsert = headers["x-upsert"];
    if (upsert !== "false" && !(upsert === "true" && allowUpsert))
      throw new GuardError(
        "blocked: an upload must say x-upsert: false unless overwriting was explicitly allowed",
      );
  }
}

export interface HttpOptions {
  target: Target;
  key: string;
  mode: Mode;
  /** restore --overwrite / --fill-missing: permits x-upsert: true. */
  allowUpsert?: boolean;
  fetchImpl?: typeof fetch;
  /** Until the response headers arrive. */
  requestTimeoutMs?: number;
  /** Longest silence while a body is streaming. */
  idleTimeoutMs?: number;
  retry?: RetryPolicy;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The run's own abort (Ctrl+C). */
  signal?: AbortSignal;
}

export interface Attempt {
  /** Call on every received chunk: resets the idle timeout. */
  touch(): void;
  signal: AbortSignal;
  attempt: number;
}

export class RunAbortedError extends Error {
  override name = "RunAbortedError";
}

export const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new RunAbortedError("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new RunAbortedError("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 60_000);
  return undefined;
}

/**
 * Storage answers many errors with HTTP 400 and the real status in the body: {"statusCode":"403","error":"Unauthorized"},
 * {"statusCode":"404","error":"not_found"}, {"statusCode":"409","error":"Duplicate"}. Both forms are understood.
 */
export async function errorFromResponse(res: Response): Promise<Error> {
  let text = "";
  try {
    text = (await res.text()).slice(0, 4000);
  } catch {
    // the body could not be read; the status is enough
  }
  let status = res.status;
  let code: string | undefined;
  let message = text;
  try {
    const body = JSON.parse(text) as {
      statusCode?: unknown;
      error?: unknown;
      message?: unknown;
      code?: unknown;
    };
    if (typeof body.statusCode === "string" && /^\d{3}$/.test(body.statusCode))
      status = Number(body.statusCode);
    else if (typeof body.statusCode === "number") status = body.statusCode;
    if (typeof body.code === "string") code = body.code;
    else if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // not JSON
  }
  const detail = redact(
    `HTTP ${res.status}${status !== res.status ? ` (${status})` : ""}${code ? ` ${code}` : ""}: ${message}`,
  )
    .replace(/\s+/g, " ")
    .slice(0, 300);
  if (status === 401 || status === 403) return new AuthError(`the key was refused: ${detail}`);
  if (status === 404) return new NotFoundError(detail);
  if (status === 409) return new ConflictError(detail);
  if ([408, 425, 429].includes(status) || status >= 500)
    return new RetryableError(detail, retryAfterMs(res.headers.get("retry-after")), status);
  return new HttpError(detail, status, code);
}

export interface RequestStats {
  requests: number;
  retries: number;
  byMethod: Record<string, number>;
}

export class StorageHttp {
  readonly stats: RequestStats = { requests: 0, retries: 0, byMethod: {} };
  private readonly fetchImpl: typeof fetch;
  private readonly retry: RetryPolicy;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly requestTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(private readonly options: HttpOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.sleep = options.sleep ?? defaultSleep;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
  }

  get target(): Target {
    return this.options.target;
  }

  /**
   * One request with bounded retries. `consume` reads the response; anything it throws as RetryableError (a body that
   * ended early, a checksum that does not match) makes the whole request run again, from the start.
   */
  async request<T>(
    method: Method,
    path: string,
    init: { body?: string | Uint8Array; headers?: Record<string, string>; attempts?: number },
    consume: (res: Response, attempt: Attempt) => Promise<T>,
  ): Promise<T> {
    const maxAttempts = init.attempts ?? this.retry.attempts;
    const url = new URL(path, this.options.target.origin);
    // The URL parser must not have moved the request anywhere else (e.g. "/../" collapsing a path).
    if (url.origin !== this.options.target.origin || url.pathname !== path.split("?")[0])
      throw new GuardError(
        `blocked: the request path was rewritten by URL parsing (${redact(path)})`,
      );
    const headers: Record<string, string> = {
      apikey: this.options.key,
      authorization: `Bearer ${this.options.key}`,
      ...init.headers,
    };
    assertAllowed(
      this.options.mode,
      method,
      url.pathname,
      headers,
      this.options.allowUpsert === true,
    );

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once(method, url, headers, init.body, consume, attempt);
      } catch (error) {
        const retryable = error instanceof RetryableError;
        if (!retryable || attempt >= maxAttempts) {
          if (error instanceof Error && retryable)
            error.message = `${error.message} (gave up after ${attempt} attempt${attempt === 1 ? "" : "s"})`;
          throw error;
        }
        this.stats.retries++;
        const backoff = Math.min(
          this.retry.maxDelayMs,
          this.retry.baseDelayMs * 2 ** (attempt - 1),
        );
        const delay =
          (error as RetryableError).retryAfterMs ?? backoff / 2 + Math.random() * (backoff / 2);
        await this.sleep(delay, this.options.signal);
      }
    }
  }

  private async once<T>(
    method: Method,
    url: URL,
    headers: Record<string, string>,
    body: string | Uint8Array | undefined,
    consume: (res: Response, attempt: Attempt) => Promise<T>,
    attempt: number,
  ): Promise<T> {
    const run = this.options.signal;
    if (run?.aborted) throw new RunAbortedError("aborted");
    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ms);
    };
    const onRunAbort = () => controller.abort();
    run?.addEventListener("abort", onRunAbort, { once: true });
    arm(this.requestTimeoutMs);
    this.stats.requests++;
    this.stats.byMethod[method] = (this.stats.byMethod[method] ?? 0) + 1;
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
          redirect: "error", // a redirect must never carry the key to another host
        });
      } catch (error) {
        throw this.transportError(error, timedOut, run);
      }
      arm(this.idleTimeoutMs);
      if (!res.ok) throw await errorFromResponse(res);
      try {
        return await consume(res, {
          touch: () => arm(this.idleTimeoutMs),
          signal: controller.signal,
          attempt,
        });
      } catch (error) {
        if (
          error instanceof RetryableError ||
          error instanceof LocalIOError ||
          error instanceof AuthError ||
          error instanceof HttpError ||
          error instanceof NotFoundError
        )
          throw error;
        throw this.transportError(error, timedOut, run);
      }
    } finally {
      if (timer) clearTimeout(timer);
      run?.removeEventListener("abort", onRunAbort);
    }
  }

  private transportError(error: unknown, timedOut: boolean, run: AbortSignal | undefined): Error {
    if (run?.aborted) return new RunAbortedError("aborted");
    if (timedOut) return new RetryableError("the request timed out");
    const cause = (error as { cause?: { code?: unknown } })?.cause;
    const code =
      (typeof cause?.code === "string" && cause.code) ||
      (error as { code?: unknown })?.code ||
      (error as Error)?.name;
    return new RetryableError(redact(`connection error: ${String(code ?? "unknown")}`));
  }

  /** JSON request/response (listing, bucket creation, upload acknowledgement). */
  json(
    method: Method,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return this.request(
      method,
      path,
      body === undefined
        ? { ...(headers ? { headers } : {}) }
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json", ...headers },
          },
      async (res) => {
        const text = await res.text();
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new RetryableError("the server answered with something that is not JSON");
        }
      },
    );
  }
}

/** Encodes an object key for a URL path, segment by segment, the way storage-js does. */
export function encodeKeyForUrl(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
