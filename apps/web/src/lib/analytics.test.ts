import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "./analytics";

const stubBrowser = (nav: Record<string, unknown> = {}) => {
  vi.stubGlobal("navigator", { doNotTrack: null, ...nav });
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
afterEach(() => vi.unstubAllGlobals());

describe("track", () => {
  it("posts a small JSON event, keepalive, same origin", () => {
    const fetchMock = stubBrowser();
    track("bottle_added", { source: "scan" }, "3b797912-bf91-424b-8746-480f3b604ecc");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/events");
    expect(init).toMatchObject({ method: "POST", keepalive: true, credentials: "same-origin" });
    expect(JSON.parse(init.body as string)).toEqual({
      name: "bottle_added",
      props: { source: "scan" },
      householdId: "3b797912-bf91-424b-8746-480f3b604ecc",
    });
  });
  it("sends nothing when Do-Not-Track or Global Privacy Control is on", () => {
    expect(stubBrowser({ doNotTrack: "1" })).not.toHaveBeenCalled();
    track("bottle_added");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const gpc = stubBrowser({ globalPrivacyControl: true });
    track("bottle_added");
    expect(gpc).not.toHaveBeenCalled();
  });
  it("never throws, even when the network does", () => {
    stubBrowser();
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    expect(() => track("bottle_added")).not.toThrow();
    vi.stubGlobal("fetch", () => {
      throw new Error("sync failure");
    });
    expect(() => track("bottle_added")).not.toThrow();
  });
});
