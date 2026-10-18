import "server-only";
import {
  DomainError,
  type OtpRequest,
  type OtpVerify,
  type PinSignIn,
  type PinStatus,
} from "@cellr/domain";
import { checkPin, pinStatus } from "@/server/privileged/pin";
import { isSignupAllowed } from "@/server/privileged/signup";
import type { AuthGateway } from "./types";

export interface AuthServiceDeps {
  /** Friendly beta pre-check. The database trigger is the real gate. */
  isSignupAllowed: (email: string) => Promise<boolean>;
  /** A right PIN gives a one-time sign-in token; a wrong one (or none) gives null and is counted. */
  checkPin: (email: string, pin: string) => Promise<{ tokenHash: string } | null>;
  pinStatus: (userId: string) => Promise<PinStatus>;
}

export function createAuthService(
  gateway: AuthGateway,
  deps: AuthServiceDeps = { isSignupAllowed, checkPin, pinStatus },
) {
  return {
    async requestCode({ email }: OtpRequest): Promise<void> {
      if (!(await deps.isSignupAllowed(email))) throw new DomainError("SIGNUP_CLOSED");
      await gateway.sendEmailOtp(email);
    },
    /** Signs in with the emailed code; says whether this person has a PIN (so the app can offer one). */
    async verifyCode({ email, code }: OtpVerify): Promise<{ pin: PinStatus }> {
      const { userId } = await gateway.verifyEmailOtp(email, code);
      const pin = await deps.pinStatus(userId).catch(() => ({ ready: false, enabled: false }));
      return { pin };
    },
    async signInWithPin({ email, pin }: PinSignIn): Promise<void> {
      const token = await deps.checkPin(email, pin);
      if (!token) throw new DomainError("PIN_INVALID");
      await gateway.verifyTokenHash(token.tokenHash);
    },
    async signOut(): Promise<void> {
      await gateway.signOut();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
