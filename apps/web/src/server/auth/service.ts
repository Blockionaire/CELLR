import "server-only";
import { DomainError, type OtpRequest, type OtpVerify } from "@cellr/domain";
import { isSignupAllowed } from "@/server/privileged/signup";
import type { AuthGateway } from "./types";

export interface AuthServiceDeps {
  /** Friendly beta pre-check. The database trigger is the real gate. */
  isSignupAllowed: (email: string) => Promise<boolean>;
}

export function createAuthService(
  gateway: AuthGateway,
  deps: AuthServiceDeps = { isSignupAllowed },
) {
  return {
    async requestCode({ email }: OtpRequest): Promise<void> {
      if (!(await deps.isSignupAllowed(email))) throw new DomainError("SIGNUP_CLOSED");
      await gateway.sendEmailOtp(email);
    },
    async verifyCode({ email, code }: OtpVerify): Promise<void> {
      await gateway.verifyEmailOtp(email, code);
    },
    async signOut(): Promise<void> {
      await gateway.signOut();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
