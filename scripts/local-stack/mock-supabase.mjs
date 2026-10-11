// A tiny stand-in for the parts of Supabase that CELLR talks to, so the whole app can run end to end
// without Docker:
//
//   REAL      Postgres (our migrations) and PostgREST (the same REST layer Supabase runs)
//   FAKE      GoTrue (Auth): email one-time codes and ES256-signed sessions, plus Supabase's gateway
//             behaviour (publishable key → anon role, service key → service_role)
//
// It is a test fixture, not a security boundary: it binds to localhost and exposes /__test/* helpers.
import crypto from "node:crypto";
import http from "node:http";
import pg from "pg";

const json = (res, status, body, headers = {}) => {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
const readJson = async (req) => {
  const buf = await readBody(req);
  try {
    return buf.length ? JSON.parse(buf.toString("utf8")) : {};
  } catch {
    return {};
  }
};

/** Keys are generated first because PostgREST needs the public JWKS before it starts. */
export function createSigningKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "local-stack",
    alg: "ES256",
    use: "sig",
  };
  return { privateKey, jwks: { keys: [jwk] }, kid: jwk.kid };
}

export async function startMockSupabase({
  port,
  pgUrl,
  postgrestUrl,
  publishableKey,
  serviceKey,
  keys,
}) {
  const base = `http://localhost:${port}`;
  const db = new pg.Pool({ connectionString: pgUrl, max: 4 });
  const codes = new Map(); // email → { code, expires }
  const refresh = new Map(); // refresh token → user id
  const b64 = (v) =>
    Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

  function sign(claims, ttl = 3600) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: "ES256", typ: "JWT", kid: keys.kid });
    const payload = b64({
      iss: `${base}/auth/v1`,
      aud: "authenticated",
      iat: now,
      exp: now + ttl,
      ...claims,
    });
    const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
      key: keys.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    return `${header}.${payload}.${sig.toString("base64url")}`;
  }

  async function findUser(email) {
    const { rows } = await db.query(
      "select id, email from auth.users where lower(email) = lower($1)",
      [email],
    );
    return rows[0] ?? null;
  }

  function sessionFor(user) {
    const now = Math.floor(Date.now() / 1000);
    const access = sign({
      sub: user.id,
      email: user.email,
      role: "authenticated",
      session_id: crypto.randomUUID(),
      aal: "aal1",
      is_anonymous: false,
    });
    const refreshToken = crypto.randomBytes(12).toString("base64url");
    refresh.set(refreshToken, user.id);
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        aud: "authenticated",
        role: "authenticated",
        email: user.email,
        email_confirmed_at: new Date().toISOString(),
        phone: "",
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
  }

  const goTrueError = (res, status, error_code, msg) =>
    json(res, status, { code: status, error_code, msg });

  async function handleAuth(req, res, url) {
    const path = url.pathname.replace(/^\/auth\/v1/, "");
    if (req.method === "GET" && path === "/.well-known/jwks.json") return json(res, 200, keys.jwks);

    if (req.method === "POST" && path === "/otp") {
      const body = await readJson(req);
      const email = String(body.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) return goTrueError(res, 422, "validation_failed", "Email is required");
      if (!(await findUser(email))) {
        if (body.create_user === false)
          return goTrueError(res, 422, "otp_disabled", "Signups not allowed for otp");
        try {
          await db.query("insert into auth.users (id, email) values (gen_random_uuid(), $1)", [
            email,
          ]); // fires our sign-up gate
        } catch {
          return goTrueError(res, 500, "unexpected_failure", "Database error saving new user");
        }
      }
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      codes.set(email, { code, expires: Date.now() + 15 * 60_000 });
      return json(res, 200, {});
    }

    if (req.method === "POST" && path === "/verify") {
      const body = await readJson(req);
      const email = String(body.email ?? "")
        .trim()
        .toLowerCase();
      const entry = codes.get(email);
      if (!entry || entry.expires < Date.now() || entry.code !== String(body.token ?? "")) {
        return goTrueError(res, 403, "otp_expired", "Token has expired or is invalid");
      }
      codes.delete(email); // single use
      const user = await findUser(email);
      return json(res, 200, sessionFor(user));
    }

    if (req.method === "POST" && path === "/token") {
      const body = await readJson(req);
      const userId = refresh.get(body.refresh_token);
      if (!userId) return goTrueError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      refresh.delete(body.refresh_token);
      const { rows } = await db.query("select id, email from auth.users where id = $1", [userId]);
      return json(res, 200, sessionFor(rows[0]));
    }

    if (req.method === "POST" && path === "/logout") return json(res, 204);
    if (req.method === "GET" && path === "/user")
      return json(res, 401, {
        code: 401,
        error_code: "no_authorization",
        msg: "Not implemented in the local stack",
      });
    return goTrueError(res, 404, "not_found", `No such endpoint: ${req.method} ${path}`);
  }

  /** Supabase's gateway: publishable key → anonymous; secret key → service_role; real sessions pass through. */
  async function handleRest(req, res, url) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "content-length", "connection", "apikey", "accept-encoding"].includes(k))
        continue;
      headers[k] = Array.isArray(v) ? v.join(",") : v;
    }
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!bearer || bearer === publishableKey) delete headers.authorization;
    else if (bearer === serviceKey)
      headers.authorization = `Bearer ${sign({ role: "service_role" }, 300)}`;

    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
    const target = `${postgrestUrl}${url.pathname.replace(/^\/rest\/v1/, "")}${url.search}`;
    const upstream = await fetch(target, { method: req.method, headers, body });
    const out = Buffer.from(await upstream.arrayBuffer());
    const outHeaders = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k))
        outHeaders[k] = v;
    });
    outHeaders["content-length"] = out.length;
    res.writeHead(upstream.status, outHeaders);
    res.end(out);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, base);
    try {
      if (url.pathname === "/__health") {
        const r = await fetch(`${postgrestUrl}/`).catch(() => null);
        return json(res, r?.ok ? 200 : 503, { ok: Boolean(r?.ok) });
      }
      if (url.pathname === "/__test/otp")
        return json(res, 200, {
          code: codes.get(String(url.searchParams.get("email") ?? "").toLowerCase())?.code ?? null,
        });
      if (url.pathname === "/__test/sql" && req.method === "POST") {
        const { sql, params } = await readJson(req);
        const result = await db.query(sql, params ?? []);
        return json(res, 200, { rows: result.rows });
      }
      if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url);
      if (url.pathname.startsWith("/rest/v1")) return await handleRest(req, res, url);
      return json(res, 404, { message: "not found" });
    } catch (error) {
      console.error("[mock-supabase]", error);
      return json(res, 500, { message: String(error?.message ?? error) });
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: base,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.end();
    },
  };
}
