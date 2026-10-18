import { describe, expect, it } from "vitest";
import {
  isGuessablePin,
  OtpCodeSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  PinSchema,
  PinSignInSchema,
} from "./auth";

describe("email", () => {
  it("is trimmed and lowercased", () => {
    expect(OtpRequestSchema.parse({ email: "  Joost@Example.COM " }).email).toBe(
      "joost@example.com",
    );
  });
  it("rejects things that are not emails", () => {
    for (const bad of ["", "joost", "joost@", "@example.com", "a b@example.com"]) {
      expect(OtpRequestSchema.safeParse({ email: bad }).success).toBe(false);
    }
  });
});

describe("OTP code", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    [" 123456\n", "123456"],
  ])("accepts %j", (input, out) => {
    expect(OtpCodeSchema.parse(input)).toBe(out);
  });
  it.each(["12345", "1234567", "abcdef", "12 34 5a", ""])("rejects %j", (input) => {
    expect(OtpCodeSchema.safeParse(input).success).toBe(false);
  });
  it("is validated together with the email", () => {
    expect(OtpVerifySchema.safeParse({ email: "a@b.co", code: "000000" }).success).toBe(true);
    expect(OtpVerifySchema.safeParse({ email: "nope", code: "000000" }).success).toBe(false);
  });
});

describe("PIN", () => {
  it.each(["000000", "111111", "123456", "987654", "890123", "121212", "123123"])(
    "%s is too easy to guess",
    (pin) => {
      expect(isGuessablePin(pin)).toBe(true);
      expect(PinSchema.safeParse(pin).success).toBe(false);
    },
  );
  it.each(["482916", "130597", "271828"])("%s is fine", (pin) => {
    expect(PinSchema.parse(pin)).toBe(pin);
  });
  it("is exactly 6 digits", () => {
    for (const bad of ["12345", "1234567", "48291a", ""])
      expect(PinSchema.safeParse(bad).success).toBe(false);
  });
  it("signing in does not judge the PIN, only its shape", () => {
    expect(PinSignInSchema.parse({ email: "A@b.co", pin: "123456" })).toEqual({
      email: "a@b.co",
      pin: "123456",
    });
  });
});
