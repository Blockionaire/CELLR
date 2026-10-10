import "server-only";

/** What the auth service needs from Supabase Auth. Implemented by gateway.ts; faked in tests. */
export interface AuthGateway {
  sendEmailOtp(email: string): Promise<void>;
  /** Verifies the code and establishes the session (cookies) on success. */
  verifyEmailOtp(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}
