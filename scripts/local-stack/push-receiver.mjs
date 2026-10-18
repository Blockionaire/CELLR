// FAKE  A Web Push service for the end-to-end tests. Real push services only speak https, so this one does too,
//       with a self-signed certificate that the test server trusts through NODE_EXTRA_CA_CERTS (nothing else
//       does). It keeps what was pushed to /push/<id>, and answers 410 Gone for ids a test marked as gone.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";

export const PUSH_DIR = path.join(os.tmpdir(), "cellr-push-receiver");
export const PUSH_CERT = path.join(PUSH_DIR, "cert.pem");
const PUSH_KEY = path.join(PUSH_DIR, "key.pem");

/** Made once and kept, so a test server that is already running keeps trusting it. */
export function ensureCertificate() {
  if (fs.existsSync(PUSH_CERT) && fs.existsSync(PUSH_KEY)) return;
  fs.mkdirSync(PUSH_DIR, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      PUSH_KEY,
      "-out",
      PUSH_CERT,
      "-days",
      "3650",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
}

export async function startPushReceiver(port) {
  ensureCertificate();
  const received = new Map();
  const gone = new Set();
  const server = https.createServer(
    { key: fs.readFileSync(PUSH_KEY), cert: fs.readFileSync(PUSH_CERT) },
    (req, res) => {
      const id = /^\/push\/([\w-]+)$/.exec(req.url ?? "")?.[1];
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.method !== "POST" || !id) return res.writeHead(404).end();
        if (gone.has(id)) return res.writeHead(410).end();
        received.set(id, [
          ...(received.get(id) ?? []),
          {
            encoding: req.headers["content-encoding"] ?? null,
            ttl: req.headers.ttl ?? null,
            vapid: String(req.headers.authorization ?? "").startsWith("vapid "),
            bytes: Buffer.concat(chunks).length,
          },
        ]);
        res.writeHead(201).end();
      });
    },
  );
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `https://localhost:${port}`,
    calls: (id) => received.get(id) ?? [],
    markGone: (id) => gone.add(id),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
