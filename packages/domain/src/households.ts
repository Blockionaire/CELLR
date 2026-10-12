import { z } from "zod";

export const HOUSEHOLD_ROLES = ["owner", "member"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const CurrencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, like EUR.");

export const HouseholdNameSchema = z.string().trim().min(1, "Give your household a name.").max(80);

export const CreateHouseholdSchema = z.object({
  name: HouseholdNameSchema,
  currency: CurrencySchema.default("EUR"),
});

export const UpdateHouseholdSchema = z
  .object({ name: HouseholdNameSchema, currency: CurrencySchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const CreateInviteSchema = z.object({
  ttlHours: z.number().int().min(1).max(720).default(168),
  maxUses: z.number().int().min(1).max(50).default(5),
});

/** Codes are 12 hex characters. Typed any way ("ABCD-EF01-2345", spaces…), stored/compared in one canonical form. */
export function normalizeInviteCode(raw: string): string {
  return raw.toLowerCase().replace(/[^0-9a-f]/g, "");
}

/** "abcdef012345" → "abcd-ef01-2345" (easier to read aloud and to copy from a message). */
export function formatInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

export const InviteCodeSchema = z
  .string()
  .transform(normalizeInviteCode)
  .pipe(z.string().regex(/^[0-9a-f]{12}$/, "Invite codes have 12 letters and numbers."));

export const JoinHouseholdSchema = z.object({ code: InviteCodeSchema });
export const SetActiveHouseholdSchema = z.object({ householdId: z.uuid() });

export const UpdateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

/** To delete your account you type your own email address: no stray tap can do it. */
export const DeleteAccountSchema = z.object({ email: z.string().trim().min(1).max(254) });
export type DeleteAccount = z.infer<typeof DeleteAccountSchema>;

export type CreateHousehold = z.infer<typeof CreateHouseholdSchema>;
export type UpdateHousehold = z.infer<typeof UpdateHouseholdSchema>;
export type CreateInvite = z.infer<typeof CreateInviteSchema>;
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;

// ---- Read models (what /api/v1 returns) -----------------------------------------------------

export interface HouseholdSummary {
  id: string;
  name: string;
  currency: string;
  /** The caller's role in this household. */
  role: HouseholdRole;
  memberCount: number;
}

export interface HouseholdMemberView {
  userId: string;
  displayName: string | null;
  role: HouseholdRole;
  joinedAt: string;
  isYou: boolean;
}

export interface HouseholdDetail extends HouseholdSummary {
  members: HouseholdMemberView[];
}

export interface InviteView {
  /** Shown once. Only a hash is stored. */
  code: string;
  formattedCode: string;
  expiresAt: string;
  maxUses: number;
}

export interface Me {
  userId: string;
  email: string | null;
  displayName: string | null;
  locale: string;
  activeHouseholdId: string | null;
  households: HouseholdSummary[];
}

/** First-run routing: where should this person land? */
export function nextOnboardingStep(
  me: Pick<Me, "displayName" | "households">,
): "household" | "name" | "done" {
  if (me.households.length === 0) return "household";
  if (!me.displayName) return "name";
  return "done";
}
