import "server-only";
import { DomainError } from "@cellr/domain";

interface DbError {
  code?: string | undefined;
  message?: string | undefined;
}

/**
 * Translates Postgres / PostgREST errors into domain errors (and therefore human copy).
 * Codes we raise ourselves: 54000 rate_limited · P0001 last_owner · 23514 slot_out_of_bounds / location_in_use.
 */
export function mapDbError(error: DbError): DomainError {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "42501") return new DomainError("FORBIDDEN", undefined, { cause: error });
  if (code === "54000" || message === "rate_limited")
    return new DomainError("RATE_LIMITED", undefined, { retryable: true });
  if (message === "last_owner") {
    return new DomainError(
      "CONFLICT",
      "You're the last owner. Delete the household instead, or hand it over first.",
    );
  }
  if (message === "slot_out_of_bounds")
    return new DomainError("VALIDATION", "That spot doesn't exist in this rack.");
  if (message === "location_in_use") {
    return new DomainError(
      "CONFLICT",
      "There are still bottles in the part you're removing. Move them first.",
    );
  }
  if (code === "23505") return new DomainError("CONFLICT", "That already exists.");
  if (code === "23503")
    return new DomainError("CONFLICT", "That is still in use, so it can't be removed yet.");
  if (["23514", "23502", "22023", "22P02", "22001"].includes(code))
    return new DomainError("VALIDATION");
  if (code === "PGRST116") return new DomainError("NOT_FOUND");
  if (code === "PGRST301" || /jwt/i.test(message)) return new DomainError("UNAUTHENTICATED");
  return new DomainError("INTERNAL", undefined, { cause: error, retryable: true });
}
