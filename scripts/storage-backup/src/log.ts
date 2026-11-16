// Output goes to stderr (progress) and never contains a key, a token, a signed URL or a connection string.

const SECRET_PATTERNS: [RegExp, string][] = [
  [/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "<redacted>"], // Supabase API keys
  [/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "<redacted>"], // JWTs (legacy keys, access tokens)
  [
    /([?&](?:token|apikey|key|signature|X-Amz-Signature|X-Amz-Credential)=)[^&\s"']+/gi,
    "$1<redacted>",
  ], // signed URLs
  [/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+@/gi, "$1<redacted>@"], // passwords in connection strings
  [/(authorization:\s*(?:bearer|basic)\s+)\S+/gi, "$1<redacted>"],
  [/(apikey:\s*)\S+/gi, "$1<redacted>"],
];

const knownSecrets = new Set<string>();

/** Registers a value that must never appear in any output (the key itself, as loaded). */
export function registerSecret(value: string): void {
  if (value.length >= 8) knownSecrets.add(value);
}

export function redact(text: string): string {
  let out = text;
  for (const secret of knownSecrets) out = out.split(secret).join("<redacted>");
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Logger {
  return {
    info: (m) => write(redact(m)),
    warn: (m) => write(redact(`WARNING: ${m}`)),
    error: (m) => write(redact(`ERROR: ${m}`)),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
