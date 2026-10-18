"use client";

import { useSyncExternalStore } from "react";

/**
 * What this phone remembers about signing in: the last email, and whether that account has a PIN. Only used to
 * open the PIN screen straight away; the server decides whether a PIN is right. Never a secret.
 */
export interface SignInMemory {
  email: string;
  pin: boolean;
  /** "Not now" to the PIN offer: do not ask again on this phone. */
  noOffer?: boolean;
}

const KEY = "cellr.signin";
const listeners = new Set<() => void>();
let cached: { raw: string | null; value: SignInMemory | null } = { raw: null, value: null };

function read(): SignInMemory | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null; // storage blocked (private mode): just ask for the email
  }
  if (raw === cached.raw) return cached.value;
  let value: SignInMemory | null = null;
  try {
    const parsed = JSON.parse(raw ?? "null") as Partial<SignInMemory> | null;
    if (parsed && typeof parsed.email === "string")
      value = { email: parsed.email, pin: parsed.pin === true, noOffer: parsed.noOffer === true };
  } catch {
    value = null;
  }
  cached = { raw, value };
  return value;
}

export function rememberSignIn(memory: SignInMemory | null) {
  try {
    if (memory) window.localStorage.setItem(KEY, JSON.stringify(memory));
    else window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do: it is only a convenience
  }
  for (const l of listeners) l();
}

/** Marks the remembered account as having (or no longer having) a PIN, keeping its email. */
export function rememberPin(pin: boolean, email?: string | null) {
  const current = read();
  const address = email ?? current?.email;
  if (address) rememberSignIn({ ...current, email: address, pin });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
};

/** null on the server and until hydrated; then what this phone remembers. */
export function useSignInMemory(): SignInMemory | null | undefined {
  return useSyncExternalStore(subscribe, read, () => undefined);
}
