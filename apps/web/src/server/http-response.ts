import "server-only";

// The shape of every JSON response the server sends: private, uncacheable and never content-sniffed. It holds no
// request handling (that is `server/http.ts`: origin check, session, body validation, error mapping), so a server
// part that only answers in JSON, such as the health endpoints or the cron round, uses this and nothing else.

/** Every API response is private and uncacheable. */
export function baseHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

export function jsonResponse(body: unknown, status = 200): Response {
  const headers = baseHeaders({ "Content-Type": "application/json; charset=utf-8" });
  return new Response(JSON.stringify(body), { status, headers });
}
