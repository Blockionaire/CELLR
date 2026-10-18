import { z } from "zod";

/** Email is the identity. Normalised so "Joost@Example.com " and "joost@example.com" are one person. */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** The 6-digit code from the sign-in email. People paste "123 456" or "123-456"; accept it. */
export const OtpCodeSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your email."));

export const OtpRequestSchema = z.object({ email: EmailSchema });
export const OtpVerifySchema = z.object({ email: EmailSchema, code: OtpCodeSchema });

export type OtpRequest = z.infer<typeof OtpRequestSchema>;
export type OtpVerify = z.infer<typeof OtpVerifySchema>;

// ---- Sign-in PIN ------------------------------------------------------------------------------------------

/** The PINs anyone would try first: one digit six times, a straight run, or a short pattern repeated. */
export function isGuessablePin(pin: string): boolean {
  const d = [...pin].map(Number);
  const steps = new Set(d.slice(1).map((x, i) => (x - d[i]! + 10) % 10));
  if (steps.size === 1 && (steps.has(0) || steps.has(1) || steps.has(9))) return true; // 111111, 123456, 987654
  if (pin.slice(0, 2).repeat(3) === pin || pin.slice(0, 3).repeat(2) === pin) return true; // 121212, 123123
  return false;
}

const SixDigits = z.string().regex(/^\d{6}$/, "Enter 6 digits.");

/** A new PIN: 6 digits, and not one that is easy to guess. */
export const PinSchema = SixDigits.refine(
  (p) => !isGuessablePin(p),
  "Choose a PIN that is harder to guess.",
);
export const SetPinSchema = z.object({ pin: PinSchema });
export const PinSignInSchema = z.object({ email: EmailSchema, pin: SixDigits });
export type PinSignIn = z.infer<typeof PinSignInSchema>;

export interface PinStatus {
  /** False until the database step for the PIN has been taken. */
  ready: boolean;
  enabled: boolean;
}
