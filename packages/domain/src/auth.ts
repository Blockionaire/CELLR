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
