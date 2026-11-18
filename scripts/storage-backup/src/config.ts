// Where the tool connects, with which key, and the checks that make a wrong project or a wrong key fail before any
// request is sent.
import { readFile, stat } from "node:fs/promises";
import { UsageError, SafetyError } from "./errors";
import { registerSecret } from "./log";

/**
 * Projects the tool never writes to, whatever the arguments say. Restoring into production is a separate, owner-only
 * procedure (docs/BACKUP-RECOVERY.md §7.5); a restore that is a test must never be able to reach it by mistake.
 */
export const PROTECTED_PROJECT_REFS: readonly string[] = ["vvelgyhbjfmjvxkzekyz"];

export interface Target {
  /** https://<ref>.supabase.co, or a local stack (http://127.0.0.1:54321). No path, no query. */
  origin: string;
  projectRef: string;
  isLoopback: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const REF = /^[a-z0-9]{20}$/;

/**
 * Parses and checks the Supabase URL. For a hosted project the ref in the host name must be the ref the operator typed
 * (--project-ref): a typo in one of the two, or a URL copied from the wrong project, stops here.
 */
export function parseTarget(rawUrl: string | undefined, expectedRef: string | undefined): Target {
  if (!rawUrl)
    throw new UsageError(
      "--url (or CELLR_BACKUP_SUPABASE_URL) is required, e.g. https://<ref>.supabase.co",
    );
  if (!expectedRef) throw new UsageError("--project-ref (or CELLR_BACKUP_PROJECT_REF) is required");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UsageError("the Supabase URL is not a valid URL");
  }
  if (url.username || url.password)
    throw new UsageError("the Supabase URL must not contain credentials");
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash)
    throw new UsageError(
      "the Supabase URL must be the project URL only, without a path (https://<ref>.supabase.co)",
    );
  const isLoopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback))
    throw new UsageError(
      "the Supabase URL must use https (plain http is only accepted for a local stack)",
    );
  const hosted = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (hosted) {
    if (hosted[1] !== expectedRef)
      throw new SafetyError(
        `the URL belongs to project "${hosted[1]}" but --project-ref says "${expectedRef}"; refusing to guess which one is meant`,
      );
    if (!REF.test(expectedRef))
      throw new UsageError(`"${expectedRef}" is not a Supabase project ref`);
  } else if (!isLoopback) {
    // A custom domain: the ref cannot be checked from the host, so it is only recorded.
    if (!REF.test(expectedRef))
      throw new UsageError(`"${expectedRef}" is not a Supabase project ref`);
  }
  return { origin: url.origin, projectRef: expectedRef, isLoopback };
}

export type KeyKind = "secret" | "service_role_jwt";

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const json: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return json && typeof json === "object" ? (json as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Only a key that can see every private object is accepted. A publishable (anon) key would make every listing come back
 * empty with status 200, and the backup would "succeed" with nothing in it: that is refused here, before any request.
 * The signature is not checked (the server does that); the claims are read only to catch the wrong key early.
 */
export function classifyKey(key: string, target: Target): KeyKind {
  const trimmed = key.trim();
  if (trimmed !== key || /\s/.test(key))
    throw new UsageError("the key contains whitespace; copy it again");
  if (key.startsWith("sb_publishable_"))
    throw new UsageError(
      "a publishable key cannot read private buckets: every listing would be empty. Use a secret key (sb_secret_...)",
    );
  if (key.startsWith("sb_secret_")) return "secret";
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
    const claims = decodeJwtPayload(key);
    if (!claims) throw new UsageError("the key looks like a JWT but cannot be read");
    if (claims.role !== "service_role")
      throw new UsageError(
        `the key is a "${String(claims.role)}" key; only a secret key or the service_role key can read private buckets`,
      );
    if (typeof claims.ref === "string" && !target.isLoopback && claims.ref !== target.projectRef)
      throw new SafetyError(
        `the key belongs to project "${claims.ref}", not to "${target.projectRef}"`,
      );
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now())
      throw new UsageError("the service_role key has expired");
    return "service_role_jwt";
  }
  throw new UsageError("the key is not a Supabase secret key (sb_secret_...) or service_role key");
}

export interface KeySources {
  env: NodeJS.ProcessEnv;
  envName: string;
  keyFile?: string | undefined;
  prompt?: (() => Promise<string>) | undefined;
}

/**
 * The key is read from a file, an environment variable, or a hidden prompt, in that order. Never from an argument:
 * arguments end up in shell history and in the process list.
 */
export async function loadKey(sources: KeySources): Promise<string> {
  let key: string | undefined;
  if (sources.keyFile) {
    const info = await stat(sources.keyFile).catch(() => {
      throw new UsageError("the key file does not exist");
    });
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
      throw new SafetyError("the key file can be read by other users; run: chmod 600 <key file>");
    key = (await readFile(sources.keyFile, "utf8")).trim();
  } else if (sources.env[sources.envName]) {
    key = sources.env[sources.envName]?.trim();
  } else if (sources.prompt) {
    key = (await sources.prompt()).trim();
  }
  if (!key)
    throw new UsageError(
      `no key: set ${sources.envName}, pass --key-file, or run in a terminal to be asked`,
    );
  registerSecret(key);
  return key;
}

/** Reads a line from the terminal without echoing it. Works in cmd.exe, PowerShell and POSIX terminals. */
export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new UsageError("no terminal to ask for the key in"));
  return new Promise((resolve, reject) => {
    let value = "";
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new UsageError("cancelled"));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}
