import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_MESSAGES } from "@cellr/domain";
import { api, ApiError, errorMessage } from "./api";

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns parsed JSON and sends JSON bodies", async () => {
    respond(200, { ok: true });
    expect(await api.post("/x", { a: 1 })).toEqual({ ok: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/v1/x");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"a":1}' });
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
  it("returns undefined for 204", async () => {
    respond(204);
    expect(await api.delete("/x")).toBeUndefined();
  });
  it("turns an error envelope into an ApiError with its code", async () => {
    respond(409, { error: { code: "CONFLICT", message: "custom", retryable: false } });
    await expect(api.get("/x")).rejects.toMatchObject({
      name: "ApiError",
      code: "CONFLICT",
      serverMessage: "custom",
      retryable: false,
    });
  });
  it("copes with a non-JSON error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })),
    );
    await expect(api.get("/x")).rejects.toMatchObject({ code: "INTERNAL", retryable: true });
  });
  it("reports a network failure as NETWORK, retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(api.get("/x")).rejects.toMatchObject({ code: "NETWORK", retryable: true });
  });
});

describe("errorMessage", () => {
  const t = (key: string) => `T(${key})`;
  it("translates by code when the server only sent the stock sentence", () => {
    const e = new ApiError("RATE_LIMITED", ERROR_MESSAGES.RATE_LIMITED, true);
    expect(errorMessage(e, t, ERROR_MESSAGES)).toBe("T(errors.RATE_LIMITED)");
  });
  it("keeps custom server wording", () => {
    const e = new ApiError("CONFLICT", "You're the last owner.", false);
    expect(errorMessage(e, t, ERROR_MESSAGES)).toBe("You're the last owner.");
  });
  it("handles network failures and unknown errors kindly", () => {
    expect(errorMessage(new ApiError("NETWORK", "", true), t, ERROR_MESSAGES)).toBe(
      "T(errors.network)",
    );
    expect(errorMessage(new Error("boom"), t, ERROR_MESSAGES)).toBe("T(errors.INTERNAL)");
  });
});
