import { AuthError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createAuthService } from "./service";
import { mapAuthError } from "./gateway";
import type { AuthGateway } from "./types";

const gateway = (): AuthGateway & { sent: string[]; verified: [string, string][] } => {
  const g = {
    sent: [] as string[],
    verified: [] as [string, string][],
    sendEmailOtp: vi.fn(async (e: string) => void g.sent.push(e)),
    verifyEmailOtp: vi.fn(async (e: string, c: string) => void g.verified.push([e, c])),
    signOut: vi.fn(async () => {}),
  };
  return g;
};

describe("auth service", () => {
  it("sends a code to an allowed email", async () => {
    const g = gateway();
    await createAuthService(g, { isSignupAllowed: async () => true }).requestCode({
      email: "a@b.co",
    });
    expect(g.sent).toEqual(["a@b.co"]);
  });
  it("refuses — before any email is sent — when the address is not on the beta list", async () => {
    const g = gateway();
    await expect(
      createAuthService(g, { isSignupAllowed: async () => false }).requestCode({ email: "x@y.co" }),
    ).rejects.toMatchObject({ code: "SIGNUP_CLOSED" });
    expect(g.sendEmailOtp).not.toHaveBeenCalled();
  });
  it("passes the verified code through", async () => {
    const g = gateway();
    await createAuthService(g, { isSignupAllowed: async () => true }).verifyCode({
      email: "a@b.co",
      code: "123456",
    });
    expect(g.verified).toEqual([["a@b.co", "123456"]]);
  });
  it("signs out", async () => {
    const g = gateway();
    await createAuthService(g, { isSignupAllowed: async () => true }).signOut();
    expect(g.signOut).toHaveBeenCalled();
  });
});

describe("mapAuthError", () => {
  const err = (message: string, status: number, code?: string) =>
    new AuthError(message, status, code);
  it("maps rate limits", () => {
    expect(mapAuthError(err("x", 429, "over_email_send_rate_limit"), "send")).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(mapAuthError(err("x", 429), "verify").code).toBe("RATE_LIMITED");
  });
  it("maps a bad or expired code to OTP_INVALID", () => {
    expect(mapAuthError(err("expired", 403, "otp_expired"), "verify").code).toBe("OTP_INVALID");
    expect(mapAuthError(err("bad", 400, "invalid_credentials"), "verify").code).toBe("OTP_INVALID");
    expect(mapAuthError(err("bad", 422), "verify").code).toBe("OTP_INVALID");
  });
  it("does not blame the user for a server-side failure", () => {
    expect(mapAuthError(err("boom", 500), "verify").code).toBe("INTERNAL");
    expect(mapAuthError(err("boom", 500, "unexpected_failure"), "send").code).toBe("INTERNAL");
  });
  it("a network failure (no HTTP status) is retryable and never 'wrong code'", () => {
    const net = new AuthError("fetch failed", 0, "unexpected_failure");
    expect(mapAuthError(net, "verify")).toMatchObject({ code: "INTERNAL", retryable: true });
    expect(mapAuthError(new AuthError("fetch failed", undefined), "verify").code).toBe("INTERNAL");
  });
  it("a 4xx while SENDING is not an invalid-code problem", () => {
    expect(mapAuthError(err("nope", 400), "send").code).toBe("INTERNAL");
  });
});
