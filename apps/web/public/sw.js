/* CELLR service worker — deliberately small.
 *
 *  • NEVER caches pages or API responses: they belong to whoever is signed in, and a shared phone
 *    must not be able to show someone else's cellar offline.
 *  • Caches only immutable build assets (/_next/static, fonts, icons) so the app shell starts fast.
 *  • When a page navigation fails (no connection) it shows /offline.html — a single static file with
 *    everything inline, pre-cached at install, so it looks right with no network at all.
 *
 * Bump VERSION to drop old caches.
 */
const VERSION = "v2";
const CACHE = `cellr-static-${VERSION}`;
const OFFLINE_URL = "/offline.html"; // fully self-contained: inline CSS and fonts, no JavaScript, no other requests
const SHELL = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cellr-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // private data: straight to the network, never stored

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()));
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
