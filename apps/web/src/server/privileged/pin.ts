import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DomainError, type PinStatus } from "@cellr/domain";
import { isMissingTable } from "@/server/db/errors";
import { createServiceClient } from "./client";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// ~50 ms per check on a server: nothing for a person, slow for anyone holding a copy of the hashes.
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

const NOT_READY =
  "The PIN needs one more database step before it works. See docs/SETUP.md, “Updating the database”.";

/** "scrypt$N$r$p$salt$hash", so the cost can be raised later without breaking stored PINs. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, KEYLEN, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(pin, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A fixed hash to check against when there is no PIN, so "no such PIN" takes as long as "wrong PIN".
let decoy: Promise<string> | null = null;

const service = () => {
  const db = createServiceClient();
  if (!db) throw new DomainError("INTERNAL", "Signing in with a PIN is not configured here.");
  return db;
};

/** Is there a PIN for this person (and can there be one yet)? */
export async function pinStatus(userId: string): Promise<PinStatus> {
  const db = createServiceClient();
  if (!db) return { ready: false, enabled: false };
  const { data, error } = await db
    .from("account_pins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error && isMissingTable(error)) return { ready: false, enabled: false };
  if (error) throw error;
  return { ready: true, enabled: data !== null };
}

export async function setPin(userId: string, pin: string): Promise<void> {
  const { error } = await service()
    .from("account_pins")
    .upsert(
      {
        user_id: userId,
        pin_hash: await hashPin(pin),
        failed: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error && isMissingTable(error)) throw new DomainError("INTERNAL", NOT_READY);
  if (error) throw error;
}

export async function removePin(userId: string): Promise<void> {
  const { error } = await service().from("account_pins").delete().eq("user_id", userId);
  if (error && !isMissingTable(error)) throw error;
}

/**
 * Checks a PIN. Right: a one-time sign-in token for that person (to be exchanged for a session by the cookie
 * client). Wrong, or no PIN for that email: null, and the wrong try is counted (five in a row and it is off).
 */
export async function checkPin(email: string, pin: string): Promise<{ tokenHash: string } | null> {
  const db = service();
  const { data, error } = await db.rpc("pin_for_email", { p_email: email });
  if (error && (isMissingTable(error) || error.code === "PGRST202")) return null;
  if (error) throw error;
  const row = data[0];
  if (!row) {
    decoy ??= hashPin("000000");
    await verifyPin(pin, await decoy);
    return null;
  }
  if (!(await verifyPin(pin, row.pin_hash))) {
    await db.rpc("pin_failed", { p_user: row.user_id });
    return null;
  }
  await db.from("account_pins").update({ failed: 0 }).eq("user_id", row.user_id);
  const link = await db.auth.admin.generateLink({ type: "magiclink", email: row.email });
  if (link.error) throw link.error;
  return { tokenHash: link.data.properties.hashed_token };
}
