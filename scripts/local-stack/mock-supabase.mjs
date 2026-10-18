// A tiny stand-in for the parts of Supabase that CELLR talks to, so the whole app can run end to end
// without Docker:
//
//   REAL      Postgres (our migrations) and PostgREST (the same REST layer Supabase runs)
//   FAKE      GoTrue (Auth): email one-time codes and ES256-signed sessions, plus Supabase's gateway
//             behaviour (publishable key → anon role, service key → service_role)
//
//   FAKE      An OpenAI-compatible chat endpoint (/openai/v1): tests program what it answers for a picture of a
//             given size via /__test/openai, and read back what it was asked via /__test/openai/calls
//   FAKE      Web Push (push-receiver.mjs, https): read back what was pushed via /__test/push/calls
//   FAKE      Storage: the real `storage.objects` policies from our migrations decide who may read, write
//             and delete (each call runs in a transaction AS the caller), the bytes live in memory
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
  push,
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

    // Deleting a sign-in is an admin act: only the service key may.
    const admin = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(path);
    if (req.method === "DELETE" && admin) {
      const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
      if (bearer !== serviceKey) return goTrueError(res, 403, "not_admin", "User not allowed");
      const result = await db.query("delete from auth.users where id = $1", [admin[1]]);
      return result.rowCount
        ? json(res, 200, {})
        : goTrueError(res, 404, "user_not_found", "User not found");
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

  // ---- Storage ---------------------------------------------------------------------------------------------
  const publicKey = crypto.createPublicKey({ key: keys.jwks.keys[0], format: "jwk" });
  const files = new Map(); // object id → Buffer

  /** Who is calling: the service key, a session signed by us, or nobody. */
  function callerOf(req) {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (bearer === serviceKey) return { role: "service_role", claims: { role: "service_role" } };
    if (!bearer) return null;
    const [h, p, sig] = bearer.split(".");
    if (!h || !p || !sig) return null;
    try {
      const ok = crypto.verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      );
      const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
      if (!ok || claims.exp < Date.now() / 1000) return null;
      return { role: "authenticated", claims };
    } catch {
      return null;
    }
  }

  /** Runs `work` in one transaction with the caller's role and claims, so row-level security applies. */
  async function asCaller(caller, work) {
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(
        "select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)",
        [caller.role, JSON.stringify(caller.claims)],
      );
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  const storageError = (res, status, error, message) =>
    json(res, status, { statusCode: String(status), error, message });

  async function handleStorage(req, res, url) {
    const caller = callerOf(req);
    if (!caller) return storageError(res, 400, "InvalidJWT", "Invalid Compact JWS");
    const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ""));

    // POST /object/{bucket}/{path}: upload (raw body, as supabase-js sends a Buffer)
    let m = /^\/object\/([^/]+)\/(.+)$/.exec(path);
    if (m && req.method === "POST") {
      const [, bucket, name] = m;
      const body = await readBody(req);
      const contentType = (req.headers["content-type"] ?? "application/octet-stream")
        .split(";")[0]
        .trim();
      const { rows } = await db.query(
        "select file_size_limit, allowed_mime_types from storage.buckets where id = $1",
        [bucket],
      );
      if (!rows[0]) return storageError(res, 404, "Bucket not found", "Bucket not found");
      if (rows[0].allowed_mime_types && !rows[0].allowed_mime_types.includes(contentType))
        return storageError(
          res,
          415,
          "invalid_mime_type",
          `mime type ${contentType} is not supported`,
        );
      if (rows[0].file_size_limit && body.length > Number(rows[0].file_size_limit))
        return storageError(
          res,
          413,
          "Payload too large",
          "The object exceeded the maximum allowed size",
        );
      try {
        const id = await asCaller(caller, async (c) => {
          const upsert = req.headers["x-upsert"] === "true";
          if (upsert)
            await c.query("delete from storage.objects where bucket_id = $1 and name = $2", [
              bucket,
              name,
            ]);
          const r = await c.query(
            "insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id",
            [
              bucket,
              name,
              caller.claims.sub ?? null,
              JSON.stringify({ mimetype: contentType, size: body.length }),
            ],
          );
          return r.rows[0].id;
        });
        files.set(id, body);
        return json(res, 200, { Id: id, Key: `${bucket}/${name}` });
      } catch (error) {
        if (error.code === "23505")
          return storageError(res, 409, "Duplicate", "The resource already exists");
        if (error.code === "42501")
          return storageError(
            res,
            403,
            "Unauthorized",
            "new row violates row-level security policy",
          );
        throw error;
      }
    }

    // GET /object/{bucket}/{path} (and /object/authenticated/...): download
    m = /^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(path);
    if (m && req.method === "GET") {
      const [, bucket, name] = m;
      const found = await asCaller(
        caller,
        async (c) =>
          (
            await c.query(
              "select id, metadata from storage.objects where bucket_id = $1 and name = $2",
              [bucket, name],
            )
          ).rows[0],
      );
      const bytes = found ? files.get(found.id) : null;
      if (!found || !bytes) return storageError(res, 400, "not_found", "Object not found");
      res.writeHead(200, {
        "content-type": found.metadata?.mimetype ?? "application/octet-stream",
        "content-length": bytes.length,
      });
      return res.end(bytes);
    }

    // DELETE /object/{bucket} with { prefixes: [...] }
    m = /^\/object\/([^/]+)$/.exec(path);
    if (m && req.method === "DELETE") {
      const { prefixes = [] } = await readJson(req);
      const removed = await asCaller(
        caller,
        async (c) =>
          (
            await c.query(
              "delete from storage.objects where bucket_id = $1 and name = any($2) returning id, name",
              [m[1], prefixes],
            )
          ).rows,
      );
      for (const r of removed) files.delete(r.id);
      return json(
        res,
        200,
        removed.map((r) => ({ id: r.id, name: r.name, bucket_id: m[1] })),
      );
    }
    return storageError(res, 404, "not_found", `No such endpoint: ${req.method} ${path}`);
  }

  // ---- An OpenAI-compatible endpoint, for tests -------------------------------------------------------------
  const programmed = new Map(); // "WxH" → { status, content, delayMs, times }
  const aiCalls = [];

  /** Width and height of a JPEG, read from its frame header. */
  function jpegSize(bytes) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xc2)
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8],
        };
      i += 2 + length;
    }
    return null;
  }

  async function handleOpenAi(req, res, url) {
    if (req.method === "POST" && url.pathname === "/__test/openai") {
      const {
        match,
        width,
        height,
        status = 200,
        content,
        sequence,
        delayMs = 0,
        times = 1000,
      } = await readJson(req);
      programmed.set(match ? `text:${match}` : `${width}x${height}`, {
        status,
        content,
        sequence,
        delayMs,
        times,
      });
      return json(res, 200, {});
    }
    if (req.method === "DELETE" && url.pathname === "/__test/openai") {
      programmed.clear();
      aiCalls.length = 0;
      return json(res, 200, {});
    }
    if (req.method === "GET" && url.pathname === "/__test/openai/calls") {
      const size = url.searchParams.get("size");
      const match = url.searchParams.get("match");
      return json(res, 200, {
        calls: aiCalls.filter(
          (c) => (size ? c.size === size : true) && (match ? c.user.includes(match) : true),
        ),
      });
    }
    if (req.method === "POST" && url.pathname === "/openai/v1/chat/completions") {
      if (!/^Bearer sk-/.test(req.headers.authorization ?? ""))
        return json(res, 401, {
          error: { message: "Incorrect API key provided", type: "invalid_request_error" },
        });
      const body = await readJson(req);
      const image = body.messages
        ?.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .find((part) => part.type === "image_url")?.image_url?.url;
      const bytes = image ? Buffer.from(image.split(",")[1] ?? "", "base64") : null;
      const dims = bytes ? jpegSize(bytes) : null;
      const userText = (body.messages ?? [])
        .filter((m) => m.role === "user")
        .flatMap((m) =>
          Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }],
        )
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      // A picture is told apart by its size; a text-only request by words only that test uses, looked for in
      // the newest question alone (the chat so far carries earlier words along).
      const newest = userText.split("Question: ").pop() ?? userText;
      const textKey = [...programmed.keys()].find(
        (k) => k.startsWith("text:") && newest.includes(k.slice(5)),
      );
      const key = dims ? `${dims.width}x${dims.height}` : (textKey ?? "none");
      aiCalls.push({
        size: key,
        model: body.model,
        strict: body.response_format?.json_schema?.strict === true,
        system: body.messages?.[0]?.content ?? "",
        user: userText,
        images: image ? 1 : 0,
      });
      const plan = programmed.get(key);
      if (!plan || plan.times <= 0)
        return json(res, 500, { error: { message: "no answer programmed" } });
      plan.times -= 1;
      if (plan.delayMs) await new Promise((r) => setTimeout(r, plan.delayMs));
      if (plan.status !== 200)
        return json(res, plan.status, { error: { message: "programmed failure" } });
      // A sequence is answered in order: a bad answer first, then the correction, for instance.
      const answer = plan.sequence ? plan.sequence.shift() : plan.content;
      return json(res, 200, {
        id: "chatcmpl-local",
        object: "chat.completion",
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: typeof answer === "string" ? answer : JSON.stringify(answer),
            },
          },
        ],
        usage: { prompt_tokens: 1500, completion_tokens: 120, total_tokens: 1620 },
      });
    }
    return json(res, 404, { error: { message: "not found" } });
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
      // The fake push service (push-receiver.mjs): what reached a phone, and making a phone "gone".
      if (url.pathname === "/__test/push/calls" && push)
        return json(res, 200, { calls: push.calls(url.searchParams.get("id") ?? "") });
      if (url.pathname === "/__test/push/gone" && req.method === "POST" && push) {
        push.markGone((await readJson(req)).id);
        return json(res, 200, {});
      }
      if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url);
      if (url.pathname.startsWith("/rest/v1")) return await handleRest(req, res, url);
      if (url.pathname.startsWith("/openai/") || url.pathname.startsWith("/__test/openai"))
        return await handleOpenAi(req, res, url);
      if (url.pathname.startsWith("/storage/v1")) return await handleStorage(req, res, url);
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
