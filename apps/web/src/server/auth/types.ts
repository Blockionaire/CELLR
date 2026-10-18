import "server-only";

/** What the auth service needs from Supabase Auth. Implemented by gateway.ts; faked in tests. */
export interface AuthGateway {
  sendEmailOtp(email: string): Promise<void>;
  /** Verifies the code and establishes the session (cookies) on success. Returns who signed in. */
  verifyEmailOtp(email: string, code: string): Promise<{ userId: string }>;
  /** Exchanges a one-time sign-in token (made by the server after a right PIN) for a session (cookies). */
  verifyTokenHash(tokenHash: string): Promise<void>;
  signOut(): Promise<void>;
}
