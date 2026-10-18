import "server-only";
import { AuthError } from "@supabase/supabase-js";
import { DomainError } from "@cellr/domain";
import { createCookieClient } from "@/server/db/clients";
import type { AuthGateway } from "./types";

/** Maps Supabase Auth failures to domain errors (and therefore human copy). */
export function mapAuthError(error: AuthError, step: "send" | "verify"): DomainError {
  const code = error.code ?? "";
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    error.status === 429
  ) {
    return new DomainError("RATE_LIMITED", undefined, { retryable: true });
  }
  // A real 4xx answer from Auth means the code was wrong/expired. Status 0 / missing means we never
  // got an answer (network down) — that is OUR problem, retryable, and must not be blamed on the user.
  const status = error.status ?? 0;
  if (
    step === "verify" &&
    (code === "otp_expired" || code === "invalid_credentials" || (status >= 400 && status < 500))
  ) {
    return new DomainError("OTP_INVALID");
  }
  return new DomainError("INTERNAL", undefined, { cause: error, retryable: true });
}

export async function createAuthGateway(): Promise<AuthGateway> {
  const db = await createCookieClient();
  return {
    async sendEmailOtp(email) {
      const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw mapAuthError(error, "send");
    },
    async verifyEmailOtp(email, code) {
      const { data, error } = await db.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw mapAuthError(error, "verify");
      if (!data.user) throw new DomainError("OTP_INVALID");
      return { userId: data.user.id };
    },
    async verifyTokenHash(tokenHash) {
      const { error } = await db.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (error) throw mapAuthError(error, "send"); // a token we just made should work: if not, it is ours
    },
    async signOut() {
      // Local scope: ends this device's session only.
      const { error } = await db.auth.signOut({ scope: "local" });
      if (error) throw new DomainError("INTERNAL", undefined, { cause: error, retryable: true });
    },
  };
}
