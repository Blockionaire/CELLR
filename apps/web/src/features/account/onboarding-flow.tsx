"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import {
  CreateHouseholdSchema,
  ERROR_MESSAGES,
  JoinHouseholdSchema,
  nextOnboardingStep,
  UpdateProfileSchema,
  type Me,
} from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { AuthHeading, AuthShell, PILL_INPUT } from "@/features/auth/auth-shell";
import { useCreateHousehold, useJoinHousehold, useMe, useUpdateProfile } from "./hooks";

type Mode = "create" | "join";

/** Two short steps, then straight to value: a household, then your name. No ten-question form. */
export function OnboardingFlow({ initialMe }: { initialMe: Me }) {
  const t = useTranslations("onboarding");
  const te = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const { data: me = initialMe } = useMe(initialMe);
  const step = nextOnboardingStep(me);

  const [mode, setMode] = useState<Mode>("create");
  const [householdName, setHouseholdName] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(me.displayName ?? "");
  const [error, setError] = useState<string | null>(null);

  const createHousehold = useCreateHousehold();
  const joinHousehold = useJoinHousehold();
  const updateProfile = useUpdateProfile({ firstTime: me.displayName === null });
  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  useEffect(() => {
    if (step === "done") {
      router.replace("/");
      router.refresh();
    }
  }, [step, router]);

  async function submitHousehold(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (mode === "create") {
        const parsed = CreateHouseholdSchema.safeParse({ name: householdName });
        if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
        await createHousehold.mutateAsync(parsed.data);
      } else {
        const parsed = JoinHouseholdSchema.safeParse({ code });
        if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
        await joinHousehold.mutateAsync(parsed.data);
      }
    } catch (e) {
      setError(message(e));
    }
  }

  async function submitName(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = UpdateProfileSchema.safeParse({ displayName: name, locale });
    if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
    try {
      await updateProfile.mutateAsync(parsed.data);
    } catch (e) {
      setError(message(e));
    }
  }

  // Count only the steps this person actually has: someone who already has a household only gives a name.
  const [total] = useState(step === "household" ? 2 : 1);
  const current = step === "household" ? 1 : total;

  return (
    <AuthShell>
      {total > 1 ? (
        <p className="mb-4 text-center text-caption font-medium uppercase tracking-[0.18em] text-bronze">
          {t("stepOf", { current, total })}
        </p>
      ) : null}

      {step === "name" ? (
        <form onSubmit={submitName} noValidate className="flex flex-col gap-6">
          <AuthHeading title={t("nameTitle")} subtitle={t("nameSubtitle")} />
          <Field
            label={t("nameLabel")}
            autoFocus
            autoComplete="given-name"
            placeholder={t("namePlaceholder")}
            error={error}
            inputClassName={PILL_INPUT}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" size="lg" block loading={updateProfile.isPending}>
            {t("finish")}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitHousehold} noValidate className="flex flex-col gap-6">
          <AuthHeading title={t("householdTitle")} subtitle={t("householdSubtitle")} />
          <Segmented<Mode>
            label={t("modeLabel")}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
            options={[
              { value: "create", label: t("modeCreate") },
              { value: "join", label: t("modeJoin") },
            ]}
            className="self-center"
          />
          {mode === "create" ? (
            <Field
              label={t("householdNameLabel")}
              autoFocus
              placeholder={t("householdNamePlaceholder")}
              error={error}
              inputClassName={PILL_INPUT}
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
            />
          ) : (
            <Field
              label={t("codeLabel")}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("codePlaceholder")}
              hint={t("codeHint")}
              error={error}
              inputClassName={PILL_INPUT}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
          <Button
            type="submit"
            size="lg"
            block
            loading={createHousehold.isPending || joinHousehold.isPending}
          >
            {mode === "create" ? t("createHousehold") : t("joinHousehold")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
