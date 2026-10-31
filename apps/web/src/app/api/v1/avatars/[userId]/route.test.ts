import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@cellr/domain";

const USER = "8b1f4c2e-3d5a-4e6f-9a7b-1c2d3e4f5a6b";

vi.mock("@/server/context", () => ({
  requireContext: vi.fn(async () => ({ userId: "me", email: "a@b.co", db: {}, via: "cookie" })),
}));
const file = vi.fn<(id: string) => Promise<Uint8Array>>(async () =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
);
vi.mock("@/server/services", () => ({ servicesFor: () => ({ avatars: { file } }) }));

const { GET } = await import("./route");
const { imageResponse } = await import("@/server/http");

const get = () =>
  GET(new Request(`https://cellr.test/api/v1/avatars/${USER}?v=x.jpg`), {
    params: Promise.resolve({ userId: USER }),
  });

describe("GET /api/v1/avatars/{userId}", () => {
  it("is never stored by the browser, so a revoked viewer can't see it again from cache", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(file).toHaveBeenCalledWith(USER);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("someone the viewer may not see is simply not found, and that isn't stored either", async () => {
    file.mockRejectedValueOnce(new DomainError("NOT_FOUND"));
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("bottle and label images keep their long private caching", () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    expect(imageResponse(bytes).headers.get("Cache-Control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(imageResponse(bytes, { changes: true }).headers.get("Cache-Control")).toBe(
      "private, no-cache",
    );
  });
});
