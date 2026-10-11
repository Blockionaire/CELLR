import "server-only";

type Fields = Record<string, string | number | boolean | null | undefined>;

/**
 * Structured one-line JSON logs. Rule: never log emails, tokens, names, photos or request bodies —
 * pass ids and codes only.
 */
export function logError(event: string, error: unknown, fields: Fields = {}): void {
  const err =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          cause: error.cause instanceof Error ? error.cause.message : undefined,
        }
      : { message: String(error) };
  console.error(JSON.stringify({ level: "error", event, ...fields, error: err }));
}

export function logWarn(event: string, fields: Fields = {}): void {
  console.warn(JSON.stringify({ level: "warn", event, ...fields }));
}
