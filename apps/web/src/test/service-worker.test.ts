import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Runs the REAL public/sw.js against fakes of the worker environment, so what it does when the network
 * is down is tested deterministically (browser "offline" emulation does not reliably reach a worker).
 */
const SOURCE = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://cellr.test";

interface FakeRequest {
  method: string;
  url: string;
  mode: string;
}
type Handler = (event: Record<string, unknown>) => void;

function boot(options: { online?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const state = {
    online: options.online ?? true,
    claimed: false,
    skipped: false,
    fetched: [] as string[],
  };
  const key = (r: string | FakeRequest) => (typeof r === "string" ? r : r.url);
  const absolute = (u: string) => new URL(u, ORIGIN).toString();

  const makeCache = (name: string) => {
    const map = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, map);
    return {
      addAll: async (urls: string[]) => {
        for (const u of urls) map.set(absolute(u), new Response(`cached:${u}`, { status: 200 }));
      },
      put: async (r: FakeRequest, response: Response) => void map.set(key(r), response),
    };
  };
  const caches = {
    open: async (name: string) => makeCache(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (r: string | FakeRequest) => {
      for (const map of stores.values()) {
        const hit = map.get(typeof r === "string" ? absolute(r) : absolute(key(r)));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => void handlers.set(type, handler),
    skipWaiting: () => void (state.skipped = true),
    clients: { claim: async () => void (state.claimed = true) },
  };
  const fetchFn = async (r: FakeRequest) => {
    state.fetched.push(new URL(r.url).pathname);
    if (!state.online) throw new TypeError("Failed to fetch");
    return new Response(`network:${new URL(r.url).pathname}`, { status: 200 });
  };
  new Function("self", "caches", "fetch", "URL", "Response", SOURCE)(
    self,
    caches,
    fetchFn,
    URL,
    Response,
  );

  const waits: Promise<unknown>[] = [];
  const dispatch = (type: string, event: Record<string, unknown>) => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no ${type} handler`);
    handler({ ...event, waitUntil: (p: Promise<unknown>) => void waits.push(p) });
  };
  /** Fires a fetch event; resolves to the worker's response, or "pass-through" if it did not handle it. */
  const request = async (
    req: Partial<FakeRequest> & { url: string },
  ): Promise<Response | "pass-through"> => {
    let answer: Promise<Response> | null = null;
    dispatch("fetch", {
      request: { method: "GET", mode: "cors", ...req, url: absolute(req.url) },
      respondWith: (p: Promise<Response>) => void (answer = p),
    });
    return answer ? await answer : "pass-through";
  };
  return {
    state,
    stores,
    request,
    install: async () => {
      dispatch("install", {});
      await Promise.all(waits.splice(0));
    },
    activate: async () => {
      dispatch("activate", {});
      await Promise.all(waits.splice(0));
    },
  };
}

describe("the service worker (public/sw.js)", () => {
  it("installs by keeping the offline page and icons ready, then takes over at once", async () => {
    const sw = boot();
    await sw.install();
    const [cache] = [...sw.stores.values()];
    expect([...cache!.keys()].map((u) => new URL(u).pathname).sort()).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/offline.html",
    ]);
    expect(sw.state.skipped).toBe(true);
    await sw.activate();
    expect(sw.state.claimed).toBe(true);
  });

  it("drops its own old caches but nothing else", async () => {
    const sw = boot();
    sw.stores.set("cellr-static-v1", new Map());
    sw.stores.set("somebody-elses", new Map());
    await sw.install();
    await sw.activate();
    expect([...sw.stores.keys()].filter((n) => n !== "somebody-elses")).toHaveLength(1);
    expect(sw.stores.has("somebody-elses")).toBe(true);
    expect(sw.stores.has("cellr-static-v1")).toBe(false);
  });

  it("with a connection, a page navigation goes straight to the network and is NOT stored", async () => {
    const sw = boot();
    await sw.install();
    await sw.activate();
    const res = await sw.request({ url: "/cellar", mode: "navigate" });
    expect(res).not.toBe("pass-through");
    expect(await (res as Response).text()).toBe("network:/cellar");
    const stored = [...sw.stores.values()].flatMap((m) =>
      [...m.keys()].map((u) => new URL(u).pathname),
    );
    expect(stored).not.toContain("/cellar");
  });

  it("with NO connection, a page navigation gets the friendly offline page", async () => {
    const sw = boot({ online: false });
    await sw.install();
    await sw.activate();
    for (const url of ["/", "/cellar", "/cellar/123", "/sign-in"]) {
      const res = (await sw.request({ url, mode: "navigate" })) as Response;
      expect(res.status, url).toBe(200);
      expect(await res.text(), url).toBe("cached:/offline.html");
    }
  });

  it("if even the offline page is missing, it fails honestly instead of inventing a page", async () => {
    const sw = boot({ online: false }); // never installed: nothing cached
    const res = (await sw.request({ url: "/cellar", mode: "navigate" })) as Response;
    expect(res.type).toBe("error");
  });

  it("never touches API calls, writes, or other sites — they go straight through", async () => {
    const sw = boot({ online: false });
    await sw.install();
    expect(await sw.request({ url: "/api/v1/cellar", mode: "navigate" })).toBe("pass-through");
    expect(await sw.request({ url: "/api/v1/bottles", method: "POST" })).toBe("pass-through");
    expect(await sw.request({ url: "/cellar", method: "POST", mode: "navigate" })).toBe(
      "pass-through",
    );
    expect(await sw.request({ url: "https://elsewhere.test/x.js" })).toBe("pass-through");
    expect(await sw.request({ url: "/some/page-data.json" })).toBe("pass-through");
  });

  it("serves build assets from its cache, fetching and keeping each one only once", async () => {
    const sw = boot();
    await sw.install();
    await sw.activate();
    const first = (await sw.request({ url: "/_next/static/chunks/app.js" })) as Response;
    expect(await first.text()).toBe("network:/_next/static/chunks/app.js");
    await Promise.resolve(); // the copy is stored in the background
    await new Promise((r) => setTimeout(r, 0));
    const second = (await sw.request({ url: "/_next/static/chunks/app.js" })) as Response;
    expect(await second.text()).toBe("network:/_next/static/chunks/app.js");
    expect(sw.state.fetched.filter((p) => p === "/_next/static/chunks/app.js")).toHaveLength(1);
  });
});
