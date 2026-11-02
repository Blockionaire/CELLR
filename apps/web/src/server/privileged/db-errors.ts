import "server-only";

/**
 * What a failed database call means, for the admin's privileged reads. Two cases look alike in a Postgres error code
 * but need different answers:
 *  - the called function (or table) itself is not there: its migration has not been run yet ("missing step");
 *  - the called function is there, but something it uses inside is not, typically an object of ANOTHER migration that
 *    was skipped (42P01 "relation … does not exist", 42883 "function … does not exist" for an inner function). Calling
 *    that "run the migration of the function you called" sends the admin to the wrong file.
 * PostgREST reports a function it cannot find as PGRST202 and a table it cannot find as PGRST205; a plain 42883 counts
 * as the called function missing only when it names that function.
 */
export type DbError = { code?: string; message?: string };

/** The called function (or table) itself is absent: its migration has not been taken yet. */
export function isMissingStep(error: DbError, called?: string): boolean {
  if (error.code === "PGRST202" || error.code === "PGRST205") return true;
  if (error.code === "42883" && called)
    return new RegExp(`function (public\\.)?${called}\\(`).test(error.message ?? "");
  return false;
}

/** The database object a function needed and did not find (another migration's), or null if that is not the error. */
export function missingDependency(error: DbError, called?: string): string | null {
  if (error.code === "42P01")
    return /relation "([^"]+)" does not exist/.exec(error.message ?? "")?.[1] ?? "a table";
  if (error.code === "42883" && !isMissingStep(error, called))
    return /function ([\w."]+)\(/.exec(error.message ?? "")?.[1] ?? "a function";
  return null;
}

/** Thrown by a privileged read when a function it called needs an object that is not in the database. */
export class MissingDependencyError extends Error {
  constructor(
    readonly called: string,
    readonly object: string,
    readonly code: string,
  ) {
    super(`${called}: the database is missing ${object} (${code})`);
    this.name = "MissingDependencyError";
  }
}

/** Where a known object comes from, to name the migration that creates it. */
export const DEPENDENCY_SOURCE: Record<string, string> = {
  "public.drink_notices": "20261018000013_push_reminders.sql (or its repair, 20261113000036)",
  "public.push_subscriptions": "20261018000013_push_reminders.sql (or its repair, 20261113000036)",
};
