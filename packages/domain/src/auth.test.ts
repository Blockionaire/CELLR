import { describe, expect, it } from "vitest";
import { OtpCodeSchema, OtpRequestSchema, OtpVerifySchema } from "./auth";

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
