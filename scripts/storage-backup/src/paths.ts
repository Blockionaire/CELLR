// Object keys become local file paths that are safe on Windows, macOS and Linux, can never leave the backup folder, and
// never collide. The exact key is always kept in the manifest; restore uses the manifest, never the file name.
import { createHash } from "node:crypto";
import path from "node:path";
import { SafetyError } from "./errors";

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Keys that cannot be fetched or stored safely: empty segments ("a//b", a leading or trailing "/") and "." or ".."
 * segments, which every URL parser collapses, so the request would silently ask for a different object.
 * Storage itself refuses such keys; this is the second line of defence.
 */
export function assertSafeKey(key: string): void {
  if (key.length === 0) throw new SafetyError("an object with an empty key");
  for (const segment of key.split("/")) {
    if (segment === "")
      throw new SafetyError(`an object key with an empty path segment: ${JSON.stringify(key)}`);
    if (segment === "." || segment === "..")
      throw new SafetyError(
        `an object key with a "${segment}" segment (path traversal): ${JSON.stringify(key)}`,
      );
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
    if (/[\u0000-\u001f\u007f]/.test(segment))
      throw new SafetyError(`an object key with a control character: ${JSON.stringify(key)}`);
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;
const MAX_SEGMENT = 120;

/**
 * One path segment → a portable file name. Kept as is: A-Z a-z 0-9 . _ - (so CELLR's "<uuid>/<uuid>.jpg" stays
 * readable). Everything else, byte by byte in UTF-8, becomes %XX: spaces, & $ @ = ; : + , ! ' * ( ) ?, non-ASCII,
 * and "%" itself, so the encoding is reversible and two different keys never encode the same. Trailing dots
 * (dropped by Windows) and device names (CON, NUL, COM1, ...) are encoded too. Long segments are shortened with a hash.
 */
export function encodeSegment(segment: string): string {
  let out = "";
  for (const byte of Buffer.from(segment, "utf8")) {
    const ch = String.fromCharCode(byte);
    out +=
      byte < 0x80 && /[A-Za-z0-9._-]/.test(ch)
        ? ch
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  if (out === "." || out === "..") out = out.replace(/\./g, "%2E");
  out = out.replace(/\.+$/, (dots) => "%2E".repeat(dots.length));
  if (WINDOWS_RESERVED.test(out))
    out = `%${out.charCodeAt(0).toString(16).toUpperCase()}${out.slice(1)}`;
  if (out.length > MAX_SEGMENT) {
    let head = out.slice(0, 80);
    head = head.replace(/%[0-9A-F]?$/, ""); // do not cut a %XX in half
    out = `${head}~${sha256Hex(segment).slice(0, 16)}`;
  }
  return out;
}

function withSuffix(relPath: string, suffix: string): string {
  const dir = path.posix.dirname(relPath);
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf(".");
  const named = dot > 0 ? `${base.slice(0, dot)}~${suffix}${base.slice(dot)}` : `${base}~${suffix}`;
  return dir === "." ? named : `${dir}/${named}`;
}

/**
 * Local paths ("objects/<bucket>/<encoded key>", POSIX separators) for every object of a backup. Deterministic: the
 * same keys always give the same paths, so `verify` can recompute them and refuse a manifest that was edited.
 *
 * Collisions are resolved, never overwritten:
 * - keys that differ only in case ("A.jpg", "a.jpg") are one file on Windows and macOS;
 * - an object and a folder with the same name ("h1" next to "h1/a.jpg") cannot both exist on any file system.
 * The later key (in sorted order), or the object that clashes with a folder, gets "~<hash of the key>" added.
 */
export function planLocalPaths(
  objects: readonly { bucket: string; key: string }[],
): Map<string, string> {
  const result = new Map<string, string>();
  const byBucket = new Map<string, string[]>();
  for (const o of objects) {
    assertSafeKey(o.key);
    if (o.bucket.length === 0 || o.bucket.includes("/"))
      throw new SafetyError(`an unusable bucket name: ${o.bucket}`);
    const keys = byBucket.get(o.bucket) ?? [];
    keys.push(o.key);
    byBucket.set(o.bucket, keys);
  }
  const bucketDirs = new Set<string>();
  for (const [bucket, keys] of [...byBucket].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const bucketDir = `objects/${encodeSegment(bucket)}`;
    if (bucketDirs.has(bucketDir.toLowerCase()))
      throw new SafetyError(`two buckets map to the same folder: ${bucket}`);
    bucketDirs.add(bucketDir.toLowerCase());
    const sorted = [...new Set(keys)].sort();
    const encoded = new Map(sorted.map((k) => [k, k.split("/").map(encodeSegment).join("/")]));
    const dirs = new Set<string>();
    for (const rel of encoded.values()) {
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/").toLowerCase());
    }
    const files = new Set<string>();
    for (const key of sorted) {
      let rel = encoded.get(key) as string;
      let hashLength = 12;
      while (files.has(rel.toLowerCase()) || dirs.has(rel.toLowerCase())) {
        if (hashLength > 64)
          throw new SafetyError(`cannot find a free local name for ${JSON.stringify(key)}`);
        rel = withSuffix(encoded.get(key) as string, sha256Hex(key).slice(0, hashLength));
        hashLength += 8;
      }
      files.add(rel.toLowerCase());
      result.set(objectId(bucket, key), `${bucketDir}/${rel}`);
    }
  }
  return result;
}

export const objectId = (bucket: string, key: string): string => `${bucket}\u0000${key}`;

/** Resolves a manifest path inside the backup folder, and refuses anything that would land outside it. */
export function resolveInside(root: string, relPath: string): string {
  if (
    path.isAbsolute(relPath) ||
    relPath.includes("\\") ||
    relPath.split("/").some((s) => s === ".." || s === "")
  )
    throw new SafetyError(`a path that leaves the backup folder: ${JSON.stringify(relPath)}`);
  const base = path.resolve(root);
  const full = path.resolve(base, ...relPath.split("/"));
  if (full !== base && !full.startsWith(base + path.sep))
    throw new SafetyError(`a path that leaves the backup folder: ${JSON.stringify(relPath)}`);
  return full;
}
