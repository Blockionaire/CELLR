import { describe, expect, it } from "vitest";
import { identify, isTransientAuthError, parseBearer, userIdFromClaims } from "./session";

describe("parseBearer", () => {
  it("extracts a JWT", () => {
    expect(parseBearer("Bearer eyJhbGciOi.payload.sig")).toBe("eyJhbGciOi.payload.sig");
    expect(parseBearer("bearer abc.def.ghi")).toBe("abc.def.ghi");
  });
  it.each([null, undefined, "", "Basic abc", "Bearer", "Bearer ", "Bearer a b", "Bearer <script>"])(
    "rejects %j",
    (h) => {
      expect(parseBearer(h)).toBeNull();
    },
  );
});

describe("userIdFromClaims", () => {
  it("accepts a signed-in user", () => {
    expect(userIdFromClaims({ sub: "u1", role: "authenticated" })).toBe("u1");
  });
  it("rejects the anon role, a missing subject, and nothing at all", () => {
    expect(userIdFromClaims({ sub: "u1", role: "anon" })).toBeNull();
    expect(userIdFromClaims({ role: "authenticated" })).toBeNull();
    expect(userIdFromClaims({ sub: "u1" })).toBeNull();
    expect(userIdFromClaims(null)).toBeNull();
    expect(userIdFromClaims(undefined)).toBeNull();
  });
});

describe("identify", () => {
  const ok = {
    data: { claims: { sub: "u1", role: "authenticated", email: "a@b.co" } },
    error: null,
  };

  it("returns the verified user", async () => {
    expect(await identify(async () => ok)).toEqual({ userId: "u1", email: "a@b.co" });
  });
  it("treats a token the auth library rejects as signed out", async () => {
    expect(
      await identify(async () => ({
        data: null,
        error: { name: "AuthInvalidJwtError", status: 400 },
      })),
    ).toBeNull();
  });
  it("treats a token that makes the library THROW as signed out, not a server error", async () => {
    expect(
      await identify(async () => {
        throw new Error("Invalid UTF-8 sequence");
      }),
    ).toBeNull();
  });
  it("treats an anon-role token as signed out", async () => {
    expect(
      await identify(async () => ({ data: { claims: { sub: "u1", role: "anon" } }, error: null })),
    ).toBeNull();
  });
  it("does NOT report an unreachable auth server as 'signed out' — that is a retryable error", async () => {
    await expect(
      identify(async () => ({ data: null, error: { name: "AuthRetryableFetchError", status: 0 } })),
    ).rejects.toMatchObject({
      code: "INTERNAL",
      retryable: true,
    });
    await expect(
      identify(async () => ({ data: null, error: { name: "AuthApiError", status: 503 } })),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
  it("tells transient failures from verdicts", () => {
    expect(isTransientAuthError({ name: "AuthRetryableFetchError" })).toBe(true);
    expect(isTransientAuthError({ status: 0 })).toBe(true);
    expect(isTransientAuthError({ status: 502 })).toBe(true);
    expect(isTransientAuthError({ status: 400 })).toBe(false);
    expect(isTransientAuthError({ status: 401 })).toBe(false);
  });
});
